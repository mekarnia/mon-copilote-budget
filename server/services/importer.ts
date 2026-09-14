import type { DB } from "../db.js";
import type { ImportBatch, ImportColumnMapping, ImportCommitInput, ImportPreview, ImportPreviewRow, TxType } from "../../shared/types.js";
import { addDays } from "../../shared/dates.js";
import { createTransaction } from "./transactions.js";
import { matchRule, normalizeLabel } from "./rules.js";
import { listCategories } from "./categories.js";
import { matchBankCategory } from "./bankCategories.js";

// ---------- Lecture du fichier ----------

export function detectDelimiter(text: string): string {
  const head = text.split(/\r?\n/).slice(0, 5).join("\n");
  const counts = [";", ",", "\t", "|"].map((d) => ({ d, n: head.split(d).length }));
  return counts.sort((a, b) => b.n - a.n)[0].d;
}

/** Analyse CSV minimaliste avec guillemets, sans dépendance. */
export function parseCsv(text: string, delimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

/** "1 234,56" | "-12.50" | "12,50 DA" -> centimes. */
export function parseAmount(raw: string): number | null {
  let s = raw.replace(/\s| /g, "").replace(/DA|DZD|€|EUR/gi, "");
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s) || s.startsWith("-");
  s = s.replace(/[()\-+]/g, "");
  // Séparateur décimal : le dernier "," ou "." ; les autres sont des milliers.
  const lastComma = s.lastIndexOf(","), lastDot = s.lastIndexOf(".");
  const dec = Math.max(lastComma, lastDot);
  if (dec >= 0 && s.length - dec - 1 <= 2) {
    s = s.slice(0, dec).replace(/[.,]/g, "") + "." + s.slice(dec + 1);
  } else s = s.replace(/[.,]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(parseFloat(s) * 100);
  return negative ? -cents : cents;
}

export function parseDate(raw: string, format: ImportColumnMapping["dateFormat"]): string | null {
  const m = raw.trim().match(/^(\d{1,4})[\/\-.](\d{1,2})[\/\-.](\d{1,4})/);
  if (!m) return null;
  let y: number, mo: number, d: number;
  if (format === "ymd") [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if (format === "mdy") [mo, d, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function detectDateFormat(values: string[]): ImportColumnMapping["dateFormat"] {
  const v = values.filter((x) => /\d/.test(x));
  if (v.some((x) => /^\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}/.test(x))) return "ymd";
  const firsts = v.map((x) => Number(x.match(/^(\d{1,2})/)?.[1] ?? 0));
  if (firsts.some((n) => n > 12)) return "dmy";
  const seconds = v.map((x) => Number(x.match(/^\d{1,4}[\/\-.](\d{1,2})/)?.[1] ?? 0));
  if (seconds.some((n) => n > 12)) return "mdy";
  return "dmy";
}

const HEADER_HINTS = {
  date: /date|jour/i,
  label: /libell|label|description|intitul|détail|detail|motif|nom/i,
  amount: /^montant$|^amount$|somme|valeur/i,
  debit: /d[ée]bit|sortie/i,
  credit: /cr[ée]dit|entr[ée]e/i,
  subCategory: /sous[\s_-]*cat[ée]gorie/i,
  category: /cat[ée]gorie|rubrique/i,
};

/** Devine la correspondance des colonnes à partir de l'en-tête et du contenu. */
export function detectMapping(columns: string[], sample: string[][]): ImportColumnMapping {
  const find = (re: RegExp) => columns.findIndex((c) => re.test(c));
  let date = find(HEADER_HINTS.date);
  let label = find(HEADER_HINTS.label);
  let amount = find(HEADER_HINTS.amount);
  let debit = find(HEADER_HINTS.debit);
  let credit = find(HEADER_HINTS.credit);
  const subCategory = find(HEADER_HINTS.subCategory);
  const category = columns.findIndex((c, i) => i !== subCategory && HEADER_HINTS.category.test(c));
  const colValues = (i: number) => sample.map((r) => r[i] ?? "");
  if (date < 0) date = columns.findIndex((_, i) => colValues(i).filter(Boolean).every((v) => /^\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4}/.test(v)));
  if (amount < 0 && debit < 0) {
    amount = columns.findIndex((_, i) => i !== date && colValues(i).filter(Boolean).every((v) => parseAmount(v) !== null));
  }
  if (label < 0) label = columns.findIndex((_, i) => i !== date && i !== amount && i !== debit && i !== credit && i !== category && i !== subCategory && colValues(i).some((v) => /[a-zA-Z]{3,}/.test(v)));
  if (debit >= 0 && credit < 0) credit = null as unknown as number;
  return {
    date: Math.max(0, date),
    label: Math.max(0, label),
    amount: amount >= 0 ? amount : null,
    debit: debit >= 0 ? debit : null,
    credit: credit !== null && credit >= 0 ? credit : null,
    category: category >= 0 ? category : null,
    subCategory: subCategory >= 0 ? subCategory : null,
    dateFormat: detectDateFormat(colValues(Math.max(0, date))),
  };
}

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

export function applyMapping(rows: string[][], mapping: ImportColumnMapping): ImportPreviewRow[] {
  return rows.map((r) => {
    const date = parseDate(r[mapping.date] ?? "", mapping.dateFormat);
    const label = (r[mapping.label] ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
    let amount: number | null = null;
    if (mapping.amount !== null) amount = parseAmount(r[mapping.amount] ?? "");
    else {
      const deb = mapping.debit !== null ? parseAmount(r[mapping.debit] ?? "") : null;
      const cred = mapping.credit !== null ? parseAmount(r[mapping.credit] ?? "") : null;
      if (deb !== null && deb !== 0) amount = -Math.abs(deb);
      else if (cred !== null && cred !== 0) amount = Math.abs(cred);
    }
    const error = !date ? "Date illisible" : amount === null || amount === 0 ? "Montant illisible" : null;
    const cell = (i: number | null) => (i === null ? "" : (r[i] ?? "").trim().slice(0, 80));
    return {
      date, label, amount, type: amount === null ? null : amount < 0 ? "expense" : "income", duplicate: false, error,
      bankCategory: cell(mapping.category), bankSubCategory: cell(mapping.subCategory), categorySource: null,
    };
  });
}

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
  for (const r of rows) {
    if (r.error || r.type === null) { r.categorySource = null; continue; }
    if (matchRule(db, r.label)) r.categorySource = "rule";
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
  const cache = new Map<string, number | null>();
  for (const r of rows) {
    if (r.error || !r.date || r.amount === null || (input.skipDuplicates && r.duplicate)) { skipped++; continue; }
    const norm = normalizeLabel(r.label);
    let categoryId = matchRule(db, r.label)?.categoryId ?? null;
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
    }, { importId, status: "to_verify", learn: false });
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
