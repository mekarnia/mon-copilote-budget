import type { DB } from "../db.js";
import type { ImportBatch, ImportColumnMapping, ImportCommitInput, ImportPreview, ImportPreviewRow, TxType } from "../../shared/types.js";
import { addDays } from "../../shared/dates.js";
import { createTransaction } from "./transactions.js";
import { loadRules, normalizeLabel } from "./rules.js";
import { listCategories } from "./categories.js";
import { matchBankCategory } from "./bankCategories.js";

export { applyMapping, detectDelimiter, detectMapping, parseAmount, parseCsv, parseDate } from "../../shared/releve.js";
import { applyMapping, detectMapping, parseCsv } from "../../shared/releve.js";

// ---------- Correspondances mémorisées par banque ----------

function mappingKey(bank: string) {
  return `importMapping:${bank.trim().toLowerCase()}`;
}

export function savedMapping(db: DB, bank: string): ImportColumnMapping | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(mappingKey(bank)) as { value: string } | undefined;
  if (!row) return null;
  const saved = JSON.parse(row.value) as ImportColumnMapping;
  return { ...saved, category: saved.category ?? null, subCategory: saved.subCategory ?? null };
}

export function saveMapping(db: DB, bank: string, mapping: ImportColumnMapping): void {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(mappingKey(bank), JSON.stringify(mapping));
}

export function knownBanks(db: DB): string[] {
  const rows = db.prepare("SELECT key FROM settings WHERE key LIKE 'importMapping:%'").all() as unknown as { key: string }[];
  return rows.map((r) => r.key.slice("importMapping:".length));
}

// ---------- Lignes, doublons ----------

/** Doublon = même montant, même sens, date à ± 3 jours, libellé proche (normalisé). */
export function markDuplicates(db: DB, rows: ImportPreviewRow[], walletId: number): void {
  const stmt = db.prepare(
    `SELECT label FROM transactions WHERE wallet_id = ? AND type = ? AND amount = ? AND date BETWEEN ? AND ?`,
  );
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.error || !r.date || r.amount === null) continue;
    const key = `${r.date}|${r.amount}|${normalizeLabel(r.label)}`;
    if (seen.has(key)) { r.duplicate = true; continue; }
    seen.add(key);
    const candidates = stmt.all(walletId, r.type, Math.abs(r.amount), addDays(r.date, -3), addDays(r.date, 3)) as unknown as { label: string }[];
    const norm = normalizeLabel(r.label);
    r.duplicate = candidates.some((c) => {
      const cn = normalizeLabel(c.label);
      return !cn || !norm || cn === norm || cn.includes(norm) || norm.includes(cn);
    });
  }
}

export function preview(db: DB, csv: string, walletId: number, bank: string | null, override?: ImportColumnMapping): ImportPreview {
  const table = parseCsv(csv);
  if (table.length < 2) throw new Error("Le fichier ne contient pas de lignes exploitables");
  const columns = table[0].map((c, i) => c.trim() || `Colonne ${i + 1}`);
  const body = table.slice(1);
  const saved = bank ? savedMapping(db, bank) : null;
  const mapping = override ?? saved ?? detectMapping(columns, body.slice(0, 20));
  const rows = applyMapping(body, mapping);
  markDuplicates(db, rows, walletId);
  markCategorySource(db, rows);
  return { columns, sample: body.slice(0, 5), mapping, savedMapping: saved !== null && !override, rows };
}

/** Indique pour chaque ligne si sa catégorie viendra d'une règle apprise, du relevé, ou de l'IA. */
export function markCategorySource(db: DB, rows: ImportPreviewRow[]): void {
  const categories = listCategories(db);
  const regles = loadRules(db);
  for (const r of rows) {
    if (r.error || r.type === null) { r.categorySource = null; continue; }
    if (regles.match(r.label)) r.categorySource = "rule";
    else if (matchBankCategory(categories, r.type, r.bankCategory, r.bankSubCategory) !== null) r.categorySource = "bank";
    else r.categorySource = "ai";
  }
}

// ---------- Validation de l'import ----------

export async function commit(
  db: DB,
  input: ImportCommitInput,
  categorize: (label: string) => Promise<number | null>,
): Promise<ImportBatch> {
  const table = parseCsv(input.csv);
  const rows = applyMapping(table.slice(1), input.mapping);
  markDuplicates(db, rows, input.walletId);
  saveMapping(db, input.bank, input.mapping);
  const res = db.prepare("INSERT INTO imports (bank, wallet_id, file_name) VALUES (?, ?, ?)").run(input.bank, input.walletId, input.fileName);
  const importId = Number(res.lastInsertRowid);
  let created = 0, skipped = 0;
  const categories = listCategories(db);
  const regles = loadRules(db); // un seul chargement pour tout l'import
  const cache = new Map<string, number | null>();
  for (const r of rows) {
    if (r.error || !r.date || r.amount === null || (input.skipDuplicates && r.duplicate)) { skipped++; continue; }
    const norm = normalizeLabel(r.label);
    let categoryId = regles.match(r.label)?.categoryId ?? null;
    const known = categoryId !== null; // libellé déjà validé par le passé
    // Le classement de la banque avant l'IA : il est gratuit, instantané et déjà fiable.
    if (categoryId === null) categoryId = matchBankCategory(categories, r.type!, r.bankCategory, r.bankSubCategory);
    if (categoryId === null) {
      if (!cache.has(norm)) cache.set(norm, await categorize(r.label));
      categoryId = cache.get(norm) ?? null;
    }
    if (categoryId === null) categoryId = fallbackCategory(db, r.type!);
    createTransaction(db, {
      type: r.type!, amount: Math.abs(r.amount), date: r.date, walletId: input.walletId, toWalletId: null,
      categoryId, projectId: null, label: r.label, note: "",
    }, { importId, status: known && input.autoConfirmKnown ? "confirmed" : "to_verify", learn: false });
    created++;
  }
  db.prepare("UPDATE imports SET created_count = ?, skipped_count = ? WHERE id = ?").run(created, skipped, importId);
  return getImport(db, importId)!;
}

function fallbackCategory(db: DB, type: TxType): number {
  const name = type === "income" ? "Autres revenus" : "Divers";
  const row = db.prepare("SELECT id FROM categories WHERE name = ? AND technical_key IS NULL ORDER BY id LIMIT 1").get(name) as { id: number } | undefined;
  if (row) return row.id;
  const any = db.prepare("SELECT id FROM categories WHERE kind = ? AND parent_id IS NOT NULL ORDER BY id LIMIT 1").get(type === "income" ? "income" : "expense") as { id: number };
  return any.id;
}

interface BatchRow { id: number; bank: string; wallet_id: number; wallet_name: string; file_name: string; created_count: number; skipped_count: number; created_at: string; remaining: number }
const BATCH_SQL = `SELECT i.*, w.name AS wallet_name, (SELECT COUNT(*) FROM transactions t WHERE t.import_id = i.id) AS remaining FROM imports i JOIN wallets w ON w.id = i.wallet_id`;
const mapBatch = (r: BatchRow): ImportBatch => ({ id: r.id, bank: r.bank, walletId: r.wallet_id, walletName: r.wallet_name, fileName: r.file_name, createdCount: r.created_count, skippedCount: r.skipped_count, createdAt: r.created_at, remaining: r.remaining });

export function listImports(db: DB): ImportBatch[] {
  return (db.prepare(`${BATCH_SQL} ORDER BY i.id DESC`).all() as unknown as BatchRow[]).map(mapBatch);
}

export function getImport(db: DB, id: number): ImportBatch | null {
  const r = db.prepare(`${BATCH_SQL} WHERE i.id = ?`).get(id) as unknown as BatchRow | undefined;
  return r ? mapBatch(r) : null;
}

/** Annuler un import supprime toutes ses opérations encore rattachées. */
export function cancelImport(db: DB, id: number): number {
  const del = db.prepare("DELETE FROM transactions WHERE import_id = ?").run(id);
  db.prepare("DELETE FROM imports WHERE id = ?").run(id);
  return Number(del.changes);
}
