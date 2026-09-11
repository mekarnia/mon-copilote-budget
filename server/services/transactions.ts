import type { DB } from "../db.js";
import { technicalCategoryId } from "../db.js";
import type { LabelSuggestion, Transaction, TransactionInput } from "../../shared/types.js";
import { monthBounds } from "../../shared/dates.js";

interface Row {
  id: number; type: Transaction["type"]; amount: number; date: string; wallet_id: number; to_wallet_id: number | null;
  category_id: number | null; project_id: number | null; recurrence_id: number | null; label: string; note: string; photo_path: string | null;
  category_name: string | null; technical_key: string | null; wallet_name: string; to_wallet_name: string | null;
}

const SELECT = `
  SELECT t.*, c.name AS category_name, c.technical_key, w.name AS wallet_name, w2.name AS to_wallet_name
  FROM transactions t
  LEFT JOIN categories c ON c.id = t.category_id
  JOIN wallets w ON w.id = t.wallet_id
  LEFT JOIN wallets w2 ON w2.id = t.to_wallet_id`;

const map = (r: Row): Transaction => ({
  id: r.id, type: r.type, amount: r.amount, date: r.date, walletId: r.wallet_id, toWalletId: r.to_wallet_id,
  categoryId: r.category_id, projectId: r.project_id, recurrenceId: r.recurrence_id, label: r.label, note: r.note,
  photoPath: r.photo_path, technical: r.technical_key !== null, categoryName: r.category_name,
  walletName: r.wallet_name, toWalletName: r.to_wallet_name,
});

export function listTransactions(db: DB, opts: { month?: string; q?: string; walletId?: number; limit?: number } = {}): Transaction[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.month) {
    const { start, end } = monthBounds(opts.month);
    where.push("t.date BETWEEN ? AND ?");
    params.push(start, end);
  }
  if (opts.q) {
    where.push("(t.label LIKE ? OR t.note LIKE ? OR c.name LIKE ?)");
    const like = `%${opts.q}%`;
    params.push(like, like, like);
  }
  if (opts.walletId) {
    where.push("(t.wallet_id = ? OR t.to_wallet_id = ?)");
    params.push(opts.walletId, opts.walletId);
  }
  const sql = `${SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY t.date DESC, t.id DESC ${opts.limit ? "LIMIT " + opts.limit : ""}`;
  return (db.prepare(sql).all(...params) as unknown as Row[]).map(map);
}

export function getTransaction(db: DB, id: number): Transaction | null {
  const r = db.prepare(`${SELECT} WHERE t.id = ?`).get(id) as unknown as Row | undefined;
  return r ? map(r) : null;
}

function normalize(input: TransactionInput, db: DB) {
  const categoryId = input.type === "transfer" ? technicalCategoryId(db, "transfer") : input.categoryId;
  const toWalletId = input.type === "transfer" ? input.toWalletId : null;
  return { ...input, categoryId, toWalletId };
}

export function createTransaction(db: DB, input: TransactionInput, extra: { recurrenceId?: number | null } = {}): Transaction {
  const v = normalize(input, db);
  const res = db
    .prepare("INSERT INTO transactions (type, amount, date, wallet_id, to_wallet_id, category_id, project_id, recurrence_id, label, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(v.type, v.amount, v.date, v.walletId, v.toWalletId, v.categoryId, v.projectId, extra.recurrenceId ?? null, v.label, v.note);
  return getTransaction(db, Number(res.lastInsertRowid))!;
}

export function updateTransaction(db: DB, id: number, input: TransactionInput): Transaction | null {
  if (!getTransaction(db, id)) return null;
  const v = normalize(input, db);
  db.prepare("UPDATE transactions SET type = ?, amount = ?, date = ?, wallet_id = ?, to_wallet_id = ?, category_id = ?, project_id = ?, label = ?, note = ? WHERE id = ?")
    .run(v.type, v.amount, v.date, v.walletId, v.toWalletId, v.categoryId, v.projectId, v.label, v.note, id);
  return getTransaction(db, id);
}

export function deleteTransaction(db: DB, id: number): boolean {
  const res = db.prepare("DELETE FROM transactions WHERE id = ?").run(id);
  return res.changes > 0;
}

export function setPhoto(db: DB, id: number, photoPath: string | null): Transaction | null {
  db.prepare("UPDATE transactions SET photo_path = ? WHERE id = ?").run(photoPath, id);
  return getTransaction(db, id);
}

/** Auto-complétion : derniers libellés distincts avec la catégorie et le portefeuille utilisés la dernière fois. */
export function suggestLabels(db: DB, q: string, limit = 8): LabelSuggestion[] {
  const rows = db
    .prepare(`SELECT label, category_id, wallet_id, type FROM transactions
      WHERE label <> '' AND label LIKE ? AND type <> 'transfer'
      GROUP BY label HAVING id = MAX(id) ORDER BY MAX(date) DESC LIMIT ?`)
    .all(`%${q}%`, limit) as unknown as { label: string; category_id: number | null; wallet_id: number; type: Transaction["type"] }[];
  return rows.map((r) => ({ label: r.label, categoryId: r.category_id, walletId: r.wallet_id, type: r.type }));
}
