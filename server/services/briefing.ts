import type { DB } from "../db.js";
import { addDays, currentMonth, monthBounds, shiftMonth, todayIso } from "../../shared/dates.js";
import { budgetLines } from "./budgets.js";
import { listProjects } from "./projects.js";
import { listWallets } from "./wallets.js";
import { upcomingBills } from "./recurrences.js";
import { monthTotals } from "./home.js";
import { computeInsights } from "./insights.js";
import { DONNEES_NON_FIABLES, texteSur } from "./securite.js";

// Le même contenu qu'un JSON, mais sans les clés répétées à chaque ligne :
// une centaine de mots au lieu de plusieurs centaines de jetons, envoyés à chaque question.

/** Dinars entiers, sans décimales ni séparateurs : le modèle n'a pas besoin du reste. */
const da = (cents: number) => String(Math.round(cents / 100));

/** Tout texte du briefing vient d'un relevé ou d'une saisie : il passe par là. */
const t = (s: string, max = 40) => texteSur(s, max);

function monthLine(db: DB, month: string): string {
  const { start, end } = monthBounds(month);
  const { income, expense } = monthTotals(db, month);
  const cats = db.prepare(
    `SELECT p.name, SUM(t.amount) AS total FROM transactions t
     JOIN categories c ON c.id = t.category_id JOIN categories p ON p.id = COALESCE(c.parent_id, c.id)
     WHERE t.type = 'expense' AND c.technical_key IS NULL AND t.date BETWEEN ? AND ?
     GROUP BY p.id ORDER BY total DESC LIMIT 6`,
  ).all(start, end) as unknown as { name: string; total: number }[];
  const detail = cats.map((c) => `${t(c.name)} ${da(c.total)}`).join(", ");
  return `${month}: entrées ${da(income)}, sorties ${da(expense)}, marge ${da(income - expense)}${detail ? ` (${detail})` : ""}`;
}

/** Instantané chiffré de la situation, en texte dense. Tout est en dinars entiers. */
export function financialBriefing(db: DB, today = todayIso()): string {
  const month = currentMonth(new Date(today + "T12:00:00"));
  const lines: string[] = [DONNEES_NON_FIABLES, `Date ${today}. Montants en dinars.`];

  const wallets = listWallets(db);
  if (wallets.length > 0) lines.push(`Soldes: ${wallets.map((w) => `${t(w.name)} ${da(w.balance)}`).join(", ")}`);

  for (const m of [month, shiftMonth(month, -1), shiftMonth(month, -2)]) lines.push(monthLine(db, m));

  const budgets = budgetLines(db, month).filter((b) => b.amount > 0);
  if (budgets.length > 0) lines.push(`Budgets ${month} (prévu/dépensé): ${budgets.map((b) => `${t(b.categoryName)} ${da(b.amount)}/${da(b.spent)}`).join(", ")}`);

  const projects = listProjects(db, today);
  if (projects.length > 0) {
    lines.push(`Projets: ${projects.map((p) => `${t(p.name)} objectif ${da(p.target)}, épargné ${da(p.saved)}${p.dueDate ? `, pour ${p.dueDate}` : ""}${p.monthlyNeeded !== null ? `, ${da(p.monthlyNeeded)}/mois` : ""}`).join(" | ")}`);
  }

  const bills = upcomingBills(db, today, addDays(today, 30));
  if (bills.length > 0) lines.push(`Échéances 30j: ${bills.map((b) => `${b.date.slice(5)} ${t(b.label)} ${da(b.amount)}`).join(", ")}`);

  // Les dérives de budget et la marge du mois se relisent dans les lignes ci-dessus :
  // ne coûtent leur place que les constats que le modèle ne peut pas recalculer seul.
  const derivable = new Set(["budget_drift", "budget_kept", "savings"]);
  const insights = computeInsights(db, today).filter((i) => !derivable.has(i.kind)).slice(0, 3);
  if (insights.length > 0) lines.push(`Constats: ${insights.map((i) => `${t(i.title, 60)} (${t(i.text, 120)})`).join(" ")}`);

  return lines.join("\n");
}
