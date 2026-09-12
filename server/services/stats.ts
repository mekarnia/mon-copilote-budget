import type { DB } from "../db.js";
import { currentMonth, monthBounds, shiftMonth } from "../../shared/dates.js";
import { monthTotals } from "./home.js";

export interface MonthPoint { month: string; income: number; expense: number; saved: number; rate: number | null }
export interface CategoryCompare { categoryId: number; name: string; icon: string | null; current: number; previous: number; delta: number }
export interface Stats {
  month: string;
  monthly: MonthPoint[];
  compare: CategoryCompare[];
  savings: { current: MonthPoint; previous: MonthPoint; average6Rate: number | null; bestMonth: MonthPoint | null };
}

/** Série mensuelle sur `count` mois se terminant à `endMonth` (inclus). */
export function monthlySeries(db: DB, endMonth: string, count = 12): MonthPoint[] {
  const out: MonthPoint[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const month = shiftMonth(endMonth, -i);
    const { income, expense } = monthTotals(db, month);
    const saved = income - expense;
    out.push({ month, income, expense, saved, rate: income > 0 ? saved / income : null });
  }
  return out;
}

/** Dépenses par catégorie principale : mois courant contre mois précédent. */
export function compareMonths(db: DB, month: string): CategoryCompare[] {
  const prev = shiftMonth(month, -1);
  const totals = (m: string) => {
    const { start, end } = monthBounds(m);
    const rows = db.prepare(`SELECT p.id, SUM(t.amount) AS total FROM transactions t JOIN categories c ON c.id = t.category_id JOIN categories p ON p.id = COALESCE(c.parent_id, c.id)
      WHERE t.type = 'expense' AND c.technical_key IS NULL AND t.date BETWEEN ? AND ? GROUP BY p.id`).all(start, end) as unknown as { id: number; total: number }[];
    return new Map(rows.map((r) => [r.id, r.total]));
  };
  const cur = totals(month), pre = totals(prev);
  const cats = db.prepare("SELECT id, name, icon FROM categories WHERE parent_id IS NULL AND kind = 'expense' ORDER BY sort").all() as unknown as { id: number; name: string; icon: string | null }[];
  return cats
    .map((c) => ({ categoryId: c.id, name: c.name, icon: c.icon, current: cur.get(c.id) ?? 0, previous: pre.get(c.id) ?? 0, delta: (cur.get(c.id) ?? 0) - (pre.get(c.id) ?? 0) }))
    .filter((c) => c.current > 0 || c.previous > 0)
    .sort((a, b) => b.current - a.current);
}

export function stats(db: DB, month = currentMonth()): Stats {
  const monthly = monthlySeries(db, month, 12);
  const current = monthly[monthly.length - 1];
  const previous = monthly[monthly.length - 2];
  const last6 = monthly.slice(-6).filter((m) => m.rate !== null);
  const average6Rate = last6.length ? last6.reduce((s, m) => s + (m.rate ?? 0), 0) / last6.length : null;
  const withIncome = monthly.filter((m) => m.income > 0);
  const bestMonth = withIncome.length ? withIncome.reduce((a, b) => ((b.rate ?? -1) > (a.rate ?? -1) ? b : a)) : null;
  return { month, monthly, compare: compareMonths(db, month), savings: { current, previous, average6Rate, bestMonth } };
}
