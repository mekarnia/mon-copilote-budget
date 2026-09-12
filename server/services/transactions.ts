import type { DB } from "../db.js";
import { technicalCategoryId } from "../db.js";
import type { LabelSuggestion, Transaction, TransactionInput } from "../../shared/types.js";
import { monthBounds, monthOf } from "../../shared/dates.js";
import { learnRule } from "./rules.js";

interface Row {
  id: number; type: Transaction["type"]; amount: number; date: string; wallet_id: number; to_wallet_id: number | null;
  category_id: number | null; project_id: number | null; recurrence_id: number | null; label: string; note: string; photo_path: string | null;
  status: Transaction["status"]; import_id: number | null; payment_method: Transaction["paymentMethod"]; time: string | null;
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
  photoPath: r.photo_path, status: r.status, importId: r.import_id, paymentMethod: r.payment_method ?? null, time: r.time ?? null, technical: r.technical_key !== null, categoryName: r.category_name,
  walletName: r.wallet_name, toWalletName: r.to_wallet_name,
});

export function listTransactions(db: DB, opts: { month?: string; q?: string; walletId?: number; limit?: number; status?: Transaction["status"]; categoryId?: number } = {}): Transaction[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.categoryId) {
    where.push("(t.category_id = ? OR c.parent_id = ?)");
    params.push(opts.categoryId, opts.categoryId);
  }
  if (opts.status) {
    where.push("t.status = ?");
    params.push(opts.status);
  }
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
  const paymentMethod = input.type === "transfer" ? null : input.paymentMethod ?? null;
  return { ...input, categoryId, toWalletId, paymentMethod, time: input.time ?? null };
}

interface CreateExtra {
  recurrenceId?: number | null;
  importId?: number | null;
  status?: Transaction["status"];
  /** Apprendre la règle libellé -> catégorie (vrai pour une saisie ou correction de l'utilisateur). */
  learn?: boolean;
}

function maybeLearn(db: DB, v: TransactionInput, learn: boolean) {
  if (learn && v.type !== "transfer" && v.label && v.categoryId) learnRule(db, v.label, v.categoryId, v.walletId);
}

export function createTransaction(db: DB, input: TransactionInput, extra: CreateExtra = {}): Transaction {
  const v = normalize(input, db);
  const res = db
    .prepare("INSERT INTO transactions (type, amount, date, wallet_id, to_wallet_id, category_id, project_id, recurrence_id, import_id, status, label, note, payment_method, time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(v.type, v.amount, v.date, v.walletId, v.toWalletId, v.categoryId, v.projectId, extra.recurrenceId ?? null, extra.importId ?? null, extra.status ?? "confirmed", v.label, v.note, v.paymentMethod, v.time);
  maybeLearn(db, v, extra.learn ?? true);
  return getTransaction(db, Number(res.lastInsertRowid))!;
}

/** Toute modification par l'utilisateur confirme l'opération et apprend la règle. */
export function updateTransaction(db: DB, id: number, input: TransactionInput): Transaction | null {
  if (!getTransaction(db, id)) return null;
  const v = normalize(input, db);
  db.prepare("UPDATE transactions SET type = ?, amount = ?, date = ?, wallet_id = ?, to_wallet_id = ?, category_id = ?, project_id = ?, label = ?, note = ?, payment_method = ?, time = ?, status = 'confirmed' WHERE id = ?")
    .run(v.type, v.amount, v.date, v.walletId, v.toWalletId, v.categoryId, v.projectId, v.label, v.note, v.paymentMethod, v.time, id);
  maybeLearn(db, v, true);
  return getTransaction(db, id);
}

export function confirmTransaction(db: DB, id: number): Transaction | null {
  const t = getTransaction(db, id);
  if (!t) return null;
  db.prepare("UPDATE transactions SET status = 'confirmed' WHERE id = ?").run(id);
  if (t.type !== "transfer" && t.label && t.categoryId) learnRule(db, t.label, t.categoryId, t.walletId);
  return getTransaction(db, id);
}

export function countToVerify(db: DB): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE status = 'to_verify'").get() as { n: number }).n;
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
    .prepare(`SELECT label, category_id, wallet_id, type, payment_method FROM transactions
      WHERE label <> '' AND label LIKE ? AND type <> 'transfer'
      GROUP BY label HAVING id = MAX(id) ORDER BY MAX(date) DESC LIMIT ?`)
    .all(`%${q}%`, limit) as unknown as { label: string; category_id: number | null; wallet_id: number; type: Transaction["type"]; payment_method: Transaction["paymentMethod"] }[];
  return rows.map((r) => ({ label: r.label, categoryId: r.category_id, walletId: r.wallet_id, type: r.type, paymentMethod: r.payment_method ?? null }));
}

export interface CategoryContext {
  month: string;
  currentId: number;
  parent: { id: number; name: string; icon: string | null; total: number; count: number } | null;
  subs: { id: number; name: string; total: number; count: number }[];
}

/** Totaux d'un mois pour une sous-catégorie et sa catégorie parente, pour un type donné (dépense ou revenu). */
export function categoryContext(db: DB, categoryId: number, month: string, type: "expense" | "income"): CategoryContext | null {
  const { start, end } = monthBounds(month);
  const cat = db.prepare("SELECT id, name, parent_id, icon, technical_key FROM categories WHERE id = ?").get(categoryId) as { id: number; name: string; parent_id: number | null; icon: string | null; technical_key: string | null } | undefined;
  if (!cat || cat.technical_key) return null;
  const sum = (id: number, withChildren: boolean) =>
    db.prepare(`SELECT COALESCE(SUM(t.amount), 0) AS total, COUNT(*) AS count FROM transactions t JOIN categories c ON c.id = t.category_id
      WHERE t.type = ? AND t.date BETWEEN ? AND ? AND ${withChildren ? "(t.category_id = ? OR c.parent_id = ?)" : "t.category_id = ?"}`)
      .get(...(withChildren ? [type, start, end, id, id] : [type, start, end, id])) as { total: number; count: number };
  const parentId = cat.parent_id ?? cat.id;
  const parent = db.prepare("SELECT id, name, icon FROM categories WHERE id = ?").get(parentId) as { id: number; name: string; icon: string | null };
  const parentTotals = sum(parent.id, true);
  const children = db.prepare("SELECT id, name FROM categories WHERE parent_id = ? ORDER BY sort, id").all(parentId) as unknown as { id: number; name: string }[];
  const subs = children
    .map((ch) => ({ id: ch.id, name: ch.name, ...sum(ch.id, false) }))
    .filter((x) => x.count > 0 || x.id === cat.id)
    .sort((a, b) => b.total - a.total);
  return {
    month,
    currentId: cat.id,
    parent: { id: parent.id, name: parent.name, icon: parent.icon, total: parentTotals.total, count: parentTotals.count },
    subs,
  };
}

/** Même chose, à partir d'une opération existante (son mois, son type, sa catégorie). */
export function transactionContext(db: DB, id: number): CategoryContext | null {
  const t = getTransaction(db, id);
  if (!t || t.technical || !t.categoryId || t.type === "transfer") return null;
  return categoryContext(db, t.categoryId, monthOf(t.date), t.type);
}
