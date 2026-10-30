import type { DB } from "../db.js";
import type { HabitSuggestion, TxType } from "../../shared/types.js";
import { addDays, todayIso } from "../../shared/dates.js";
import { classerHabitudes, type LigneHabitude } from "../../shared/habitudes.js";

/**
 * Habitudes de l'utilisateur : libellés déjà saisis pour une catégorie (ou toutes),
 * classés par fréquence × récence, avec un bonus si le montant saisi est proche du montant habituel.
 */
export function suggestHabits(
  db: DB,
  opts: { type: TxType; categoryId?: number | null; amount?: number | null; limit?: number; today?: string },
): HabitSuggestion[] {
  const today = opts.today ?? todayIso();
  const since = addDays(today, -365);
  const params: (string | number)[] = [opts.type, since];
  let where = "t.type = ? AND t.label <> '' AND t.date >= ? AND c.technical_key IS NULL";
  if (opts.categoryId) {
    where += " AND (t.category_id = ? OR c.parent_id = ? OR c.id = (SELECT parent_id FROM categories WHERE id = ?))";
    params.push(opts.categoryId, opts.categoryId, opts.categoryId);
  }
  const rows = db
    .prepare(`SELECT t.label, t.category_id, t.wallet_id, t.payment_method, t.amount, t.date
      FROM transactions t JOIN categories c ON c.id = t.category_id WHERE ${where} ORDER BY t.date DESC, t.id DESC`)
    .all(...params) as unknown as LigneHabitude[];

  return classerHabitudes(rows, { amount: opts.amount, limit: opts.limit, today });
}
