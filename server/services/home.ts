import type { DB } from "../db.js";
import type { CategoryTotal, HomeSummary } from "../../shared/types.js";
import { addDays, monthBounds, todayIso } from "../../shared/dates.js";
import { budgetLines } from "./budgets.js";
import { upcomingBills } from "./recurrences.js";
import { listProjects } from "./projects.js";
import { listWallets } from "./wallets.js";

export function monthTotals(db: DB, month: string): { income: number; expense: number } {
  const { start, end } = monthBounds(month);
  const r = db
    .prepare(`SELECT
      COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount END), 0) AS income,
      COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount END), 0) AS expense
      FROM transactions t JOIN categories c ON c.id = t.category_id
      WHERE c.technical_key IS NULL AND t.date BETWEEN ? AND ?`)
    .get(start, end) as { income: number; expense: number };
  return r;
}

export function byCategory(db: DB, month: string): CategoryTotal[] {
  const { start, end } = monthBounds(month);
  return db
    .prepare(`SELECT p.id AS categoryId, p.name, p.icon, SUM(t.amount) AS total
      FROM transactions t JOIN categories c ON c.id = t.category_id JOIN categories p ON p.id = COALESCE(c.parent_id, c.id)
      WHERE t.type = 'expense' AND c.technical_key IS NULL AND t.date BETWEEN ? AND ?
      GROUP BY p.id ORDER BY total DESC`)
    .all(start, end) as unknown as CategoryTotal[];
}

export function homeSummary(db: DB, month: string, today = todayIso()): HomeSummary {
  const { income, expense } = monthTotals(db, month);
  const { end } = monthBounds(month);
  // Factures à venir d'ici la fin du mois (uniquement si le mois affiché est en cours ou futur).
  const from = today > end ? addDays(end, 1) : addDays(today, 0);
  const restOfMonth = from <= end ? upcomingBills(db, from, end) : [];
  const upcomingExpense = restOfMonth.filter((b) => b.type === "expense").reduce((s, b) => s + b.amount, 0);
  const upcomingIncome = restOfMonth.filter((b) => b.type === "income").reduce((s, b) => s + b.amount, 0);
  const wallets = listWallets(db);
  return {
    month,
    income,
    expense,
    upcomingExpense,
    remaining: income + upcomingIncome - expense - upcomingExpense,
    byCategory: byCategory(db, month),
    upcoming: upcomingBills(db, today, addDays(today, 7)),
    redBudgets: budgetLines(db, month).filter((b) => b.status === "red"),
    projects: listProjects(db, today).filter((p) => !p.done),
    walletsTotal: wallets.reduce((s, w) => s + w.balance, 0),
  };
}
