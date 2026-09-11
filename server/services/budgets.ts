import type { DB } from "../db.js";
import type { BudgetLine } from "../../shared/types.js";
import { monthBounds } from "../../shared/dates.js";

/** Dépenses du mois par catégorie parente, hors catégories techniques. */
export function spentByParent(db: DB, month: string): Map<number, number> {
  const { start, end } = monthBounds(month);
  const rows = db
    .prepare(`SELECT COALESCE(c.parent_id, c.id) AS parent, SUM(t.amount) AS total
      FROM transactions t JOIN categories c ON c.id = t.category_id
      WHERE t.type = 'expense' AND c.technical_key IS NULL AND t.date BETWEEN ? AND ?
      GROUP BY parent`)
    .all(start, end) as unknown as { parent: number; total: number }[];
  return new Map(rows.map((r) => [r.parent, r.total]));
}

export function statusOf(ratio: number, hasBudget: boolean): BudgetLine["status"] {
  if (!hasBudget) return "none";
  if (ratio > 1) return "red";
  if (ratio >= 0.8) return "orange";
  return "green";
}

export function budgetLines(db: DB, month: string): BudgetLine[] {
  const spent = spentByParent(db, month);
  const rows = db
    .prepare(`SELECT c.id, c.name, c.icon, b.amount FROM categories c LEFT JOIN budgets b ON b.category_id = c.id
      WHERE c.parent_id IS NULL AND c.kind = 'expense' ORDER BY c.sort`)
    .all() as unknown as { id: number; name: string; icon: string | null; amount: number | null }[];
  return rows.map((r) => {
    const s = spent.get(r.id) ?? 0;
    const amount = r.amount ?? 0;
    const ratio = amount > 0 ? s / amount : 0;
    return { categoryId: r.id, categoryName: r.name, icon: r.icon, amount, spent: s, ratio, status: statusOf(ratio, amount > 0) };
  });
}

export function setBudget(db: DB, categoryId: number, amount: number): void {
  if (amount <= 0) {
    db.prepare("DELETE FROM budgets WHERE category_id = ?").run(categoryId);
    return;
  }
  db.prepare("INSERT INTO budgets (category_id, amount) VALUES (?, ?) ON CONFLICT(category_id) DO UPDATE SET amount = excluded.amount").run(categoryId, amount);
}
