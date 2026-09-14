import type { DB } from "../db.js";
import type { BudgetLine } from "../../shared/types.js";
import { monthBounds, shiftMonth } from "../../shared/dates.js";
import { formatCents } from "../../shared/money.js";

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
    .prepare(`SELECT c.id, c.name, c.icon, b.amount FROM categories c LEFT JOIN budgets b ON b.category_id = c.id AND b.month = ?
      WHERE c.parent_id IS NULL AND c.kind = 'expense' ORDER BY c.sort`)
    .all(month) as unknown as { id: number; name: string; icon: string | null; amount: number | null }[];
  return rows.map((r) => {
    const s = spent.get(r.id) ?? 0;
    const amount = r.amount ?? 0;
    const ratio = amount > 0 ? s / amount : 0;
    return { categoryId: r.id, categoryName: r.name, icon: r.icon, amount, spent: s, ratio, status: statusOf(ratio, amount > 0) };
  });
}

/** Le budget d'un mois est indépendant des autres mois. */
export function setBudget(db: DB, categoryId: number, month: string, amount: number): void {
  if (amount <= 0) {
    db.prepare("DELETE FROM budgets WHERE category_id = ? AND month = ?").run(categoryId, month);
    return;
  }
  db.prepare("INSERT INTO budgets (category_id, month, amount) VALUES (?, ?, ?) ON CONFLICT(category_id, month) DO UPDATE SET amount = excluded.amount").run(categoryId, month, amount);
}

export interface BudgetSummary {
  month: string;
  budget: number;
  spent: number;
  /** Budget moins dépenses, sur les catégories budgétées : positif = économies, négatif = dépassement. */
  saved: number;
  hasBudgets: boolean;
  previousMonthHasBudgets: boolean;
}

export function budgetSummary(db: DB, month: string): BudgetSummary {
  const lines = budgetLines(db, month).filter((b) => b.amount > 0);
  const budget = lines.reduce((s, b) => s + b.amount, 0);
  const spent = lines.reduce((s, b) => s + b.spent, 0);
  const prev = db.prepare("SELECT COUNT(*) AS n FROM budgets WHERE month = ?").get(shiftMonth(month, -1)) as { n: number };
  return { month, budget, spent, saved: budget - spent, hasBudgets: lines.length > 0, previousMonthHasBudgets: prev.n > 0 };
}

/** Reprend tels quels les budgets d'un mois vers un autre (sans écraser ceux déjà saisis). */
export function copyBudgets(db: DB, from: string, to: string): number {
  const res = db.prepare("INSERT OR IGNORE INTO budgets (category_id, month, amount) SELECT category_id, ?, amount FROM budgets WHERE month = ?").run(to, from);
  return Number(res.changes);
}

export interface BudgetSuggestion {
  categoryId: number;
  categoryName: string;
  icon: string | null;
  previousBudget: number;
  lastSpent: number;
  average3: number;
  saved: number;
  suggested: number;
  reason: string;
}

/** Arrondi à la centaine de dinars supérieure. */
const roundUp100 = (cents: number) => Math.ceil(cents / 10000) * 10000;

/** Suggestion déterministe pour `month`, à partir des trois mois précédents. */
export function suggestBudgets(db: DB, month: string): BudgetSuggestion[] {
  const m1 = shiftMonth(month, -1), m2 = shiftMonth(month, -2), m3 = shiftMonth(month, -3);
  const s1 = spentByParent(db, m1), s2 = spentByParent(db, m2), s3 = spentByParent(db, m3);
  const prevBudgets = new Map(budgetLines(db, m1).map((b) => [b.categoryId, b]));
  const cats = db.prepare("SELECT id, name, icon FROM categories WHERE parent_id IS NULL AND kind = 'expense' ORDER BY sort").all() as unknown as { id: number; name: string; icon: string | null }[];
  const out: BudgetSuggestion[] = [];
  for (const c of cats) {
    const last = s1.get(c.id) ?? 0;
    const months = [s1.get(c.id), s2.get(c.id), s3.get(c.id)].filter((v): v is number => v !== undefined);
    const average3 = months.length ? Math.round(months.reduce((a, b) => a + b, 0) / months.length) : 0;
    const prev = prevBudgets.get(c.id)?.amount ?? 0;
    if (last === 0 && average3 === 0 && prev === 0) continue;
    const saved = prev > 0 ? prev - last : 0;
    let suggested: number, reason: string;
    if (average3 === 0) {
      suggested = prev;
      reason = "Aucune dépense sur trois mois, budget précédent conservé.";
    } else if (prev > 0 && last > prev) {
      suggested = roundUp100(Math.max(average3, last) * 1.05);
      reason = `Dépassé le mois dernier (${formatCents(last)} pour ${formatCents(prev)}) : budget relevé au niveau réel.`;
    } else if (prev > 0 && saved > prev * 0.25) {
      suggested = roundUp100(Math.max(average3 * 1.1, last * 1.15));
      reason = `${formatCents(saved)} économisés le mois dernier : budget resserré vers la dépense réelle.`;
    } else {
      suggested = roundUp100(average3 * 1.05);
      reason = `Moyenne des trois derniers mois (${formatCents(average3)}) avec 5 % de marge.`;
    }
    out.push({ categoryId: c.id, categoryName: c.name, icon: c.icon, previousBudget: prev, lastSpent: last, average3, saved, suggested, reason });
  }
  return out;
}

export function applyBudgets(db: DB, month: string, items: { categoryId: number; amount: number }[]): void {
  for (const i of items) setBudget(db, i.categoryId, month, i.amount);
}
