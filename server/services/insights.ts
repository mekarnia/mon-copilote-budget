import type { DB } from "../db.js";
import type { Insight } from "../../shared/types.js";
import { addDays, currentMonth, monthBounds, shiftMonth, todayIso } from "../../shared/dates.js";
import { formatCents } from "../../shared/money.js";
import { budgetLines } from "./budgets.js";
import { listProjects } from "./projects.js";
import { listWallets } from "./wallets.js";
import { upcomingBills } from "./recurrences.js";
import { normalizeLabel } from "./rules.js";
import { monthTotals } from "./home.js";

/** Analyse déterministe, sans IA : ce sont les faits que le coach commente. */
export function computeInsights(db: DB, today = todayIso()): Insight[] {
  const out: Insight[] = [];
  const month = currentMonth(new Date(today + "T12:00:00"));
  const { start, end } = monthBounds(month);
  const dayOfMonth = Number(today.slice(8, 10));
  const daysInMonth = Number(end.slice(8, 10));
  const elapsed = dayOfMonth / daysInMonth;

  // 1. Dérive de budget : au rythme actuel, la catégorie dépassera son budget.
  for (const b of budgetLines(db, month)) {
    if (b.amount <= 0 || b.spent === 0) continue;
    const projected = elapsed > 0 ? b.spent / elapsed : b.spent;
    if (b.status === "red") {
      out.push({ kind: "budget_drift", severity: "warning", title: `Budget ${b.categoryName} dépassé`, text: `${formatCents(b.spent)} dépensés pour ${formatCents(b.amount)} prévus.`, amount: b.spent - b.amount, link: "/budgets" });
    } else if (projected > b.amount * 1.15 && dayOfMonth >= 5) {
      out.push({ kind: "budget_drift", severity: "warning", title: `${b.categoryName} file plus vite que prévu`, text: `Au rythme actuel, le mois finirait vers ${formatCents(Math.round(projected))} pour un budget de ${formatCents(b.amount)}.`, amount: Math.round(projected) - b.amount, link: "/budgets" });
    }
  }

  // 2. Dépense inhabituelle : sur les 7 derniers jours, plus de 2 fois la moyenne de la catégorie sur 3 mois, et plus de 50 €.
  const since = addDays(today, -7);
  const recent = db.prepare(`SELECT t.id, t.amount, t.label, t.date, c.name AS category, COALESCE(c.parent_id, c.id) AS parent
    FROM transactions t JOIN categories c ON c.id = t.category_id
    WHERE t.type = 'expense' AND c.technical_key IS NULL AND t.date BETWEEN ? AND ?`).all(since, today) as unknown as { id: number; amount: number; label: string; date: string; category: string; parent: number }[];
  const avgStmt = db.prepare(`SELECT AVG(t.amount) AS avg, COUNT(*) AS n FROM transactions t JOIN categories c ON c.id = t.category_id
    WHERE t.type = 'expense' AND COALESCE(c.parent_id, c.id) = ? AND t.date BETWEEN ? AND ? AND t.id <> ?`);
  for (const r of recent) {
    if (r.amount < 5000) continue;
    const a = avgStmt.get(r.parent, addDays(today, -90), addDays(today, -1), r.id) as { avg: number | null; n: number };
    if (a.n >= 3 && a.avg && r.amount > a.avg * 2) {
      out.push({ kind: "unusual_expense", severity: "info", title: `Dépense inhabituelle : ${r.label || r.category}`, text: `${formatCents(r.amount)} le ${r.date.slice(8, 10)}/${r.date.slice(5, 7)}, contre ${formatCents(Math.round(a.avg))} en moyenne en ${r.category}.`, amount: r.amount, link: `/operation/${r.id}` });
    }
  }

  // 3. Abonnement non déclaré : même libellé, montant proche, présent sur 3 mois consécutifs, sans récurrence.
  const m1 = shiftMonth(month, -1), m2 = shiftMonth(month, -2), m3 = shiftMonth(month, -3);
  const rows = db.prepare(`SELECT label, amount, date FROM transactions WHERE type = 'expense' AND recurrence_id IS NULL AND label <> '' AND date BETWEEN ? AND ?`)
    .all(monthBounds(m3).start, end) as unknown as { label: string; amount: number; date: string }[];
  const byLabel = new Map<string, { label: string; months: Set<string>; amounts: number[] }>();
  for (const r of rows) {
    const k = normalizeLabel(r.label);
    if (k.length < 3) continue;
    const e = byLabel.get(k) ?? { label: r.label, months: new Set(), amounts: [] };
    e.months.add(r.date.slice(0, 7));
    e.amounts.push(r.amount);
    byLabel.set(k, e);
  }
  const declared = new Set((db.prepare("SELECT label FROM recurrences").all() as unknown as { label: string }[]).map((r) => normalizeLabel(r.label)));
  for (const [k, e] of byLabel) {
    if (declared.has(k)) continue;
    const consecutive = [m1, m2, m3].filter((m) => e.months.has(m)).length >= 3 || [month, m1, m2].every((m) => e.months.has(m));
    if (!consecutive) continue;
    const min = Math.min(...e.amounts), max = Math.max(...e.amounts);
    if (max > min * 1.15) continue;
    out.push({ kind: "undeclared_recurrence", severity: "info", title: `${e.label} revient chaque mois`, text: `Environ ${formatCents(Math.round(e.amounts.reduce((s, x) => s + x, 0) / e.amounts.length))} par mois. Déclarez-le en récurrence pour le voir venir.`, amount: null, link: "/reglages/recurrences" });
  }

  // 4. Solde bas : un portefeuille ne couvre pas les factures des 7 prochains jours.
  const bills = upcomingBills(db, today, addDays(today, 7));
  for (const w of listWallets(db)) {
    const due = bills.filter((b) => b.type === "expense" && b.recurrenceId).reduce((s, b) => s + b.amount, 0);
    if (w.type === "courant" && w.balance < due) {
      out.push({ kind: "low_balance", severity: "warning", title: `${w.name} : solde juste`, text: `${formatCents(w.balance)} disponibles pour ${formatCents(due)} de factures cette semaine.`, amount: due - w.balance, link: "/reglages/portefeuilles" });
    } else if (w.balance < 0) {
      out.push({ kind: "low_balance", severity: "warning", title: `${w.name} est à découvert`, text: `Solde ${formatCents(w.balance)}. Pensez à corriger le solde si ce n'est pas le cas réellement.`, amount: -w.balance, link: "/reglages/portefeuilles" });
    }
  }

  // 5. Bonnes nouvelles : projet alimenté cette semaine, budgets tenus le mois dernier, taux d'épargne.
  const fed = db.prepare(`SELECT p.name, SUM(t.amount) AS total FROM transactions t JOIN projects p ON p.id = t.project_id
    WHERE t.type = 'transfer' AND t.to_wallet_id = p.wallet_id AND t.date BETWEEN ? AND ? GROUP BY p.id`).all(since, today) as unknown as { name: string; total: number }[];
  for (const f of fed) out.push({ kind: "project_progress", severity: "good", title: `${formatCents(f.total)} mis de côté pour ${f.name}`, text: "Continuez comme ça, chaque virement compte.", amount: f.total, link: "/projets" });
  for (const p of listProjects(db, today)) {
    if (p.done && p.saved >= p.target) out.push({ kind: "project_progress", severity: "good", title: `Objectif ${p.name} atteint 🎉`, text: `${formatCents(p.target)} réunis.`, amount: p.target, link: "/projets" });
  }
  if (dayOfMonth <= 7) {
    const kept = budgetLines(db, m1).filter((b) => b.amount > 0 && b.spent <= b.amount);
    const all = budgetLines(db, m1).filter((b) => b.amount > 0);
    if (all.length > 0 && kept.length === all.length) out.push({ kind: "budget_kept", severity: "good", title: "Tous les budgets tenus le mois dernier", text: `${all.length} budget${all.length > 1 ? "s" : ""} respecté${all.length > 1 ? "s" : ""}. Bravo.`, amount: null, link: "/budgets" });
  }
  const last = monthTotals(db, m1);
  if (last.income > 0) {
    const rate = (last.income - last.expense) / last.income;
    if (rate >= 0.1) out.push({ kind: "savings", severity: "good", title: `${Math.round(rate * 100)} % de revenus non dépensés le mois dernier`, text: `${formatCents(last.income - last.expense)} de marge. Un virement vers un projet ?`, amount: last.income - last.expense, link: "/projets" });
  }

  const order = { warning: 0, info: 1, good: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 6);
}

export function contextSummary(db: DB, today = todayIso()) {
  const month = currentMonth(new Date(today + "T12:00:00"));
  const months = [month, shiftMonth(month, -1), shiftMonth(month, -2)];
  const byMonth = months.map((m) => {
    const { start, end } = monthBounds(m);
    const cats = db.prepare(`SELECT p.name, SUM(t.amount) AS total FROM transactions t JOIN categories c ON c.id = t.category_id JOIN categories p ON p.id = COALESCE(c.parent_id, c.id)
      WHERE t.type = 'expense' AND c.technical_key IS NULL AND t.date BETWEEN ? AND ? GROUP BY p.id ORDER BY total DESC`).all(start, end) as unknown as { name: string; total: number }[];
    return { month: m, ...monthTotals(db, m), byCategory: cats.map((c) => ({ name: c.name, total: c.total / 100 })) };
  });
  return {
    today,
    wallets: listWallets(db).map((w) => ({ name: w.name, balance: w.balance / 100 })),
    months: byMonth.map((m) => ({ ...m, income: m.income / 100, expense: m.expense / 100 })),
    budgets: budgetLines(db, month).filter((b) => b.amount > 0).map((b) => ({ category: b.categoryName, budget: b.amount / 100, spent: b.spent / 100 })),
    projects: listProjects(db, today).map((p) => ({ name: p.name, target: p.target / 100, saved: p.saved / 100, dueDate: p.dueDate, monthlyNeeded: p.monthlyNeeded === null ? null : p.monthlyNeeded / 100 })),
    upcoming: upcomingBills(db, today, addDays(today, 30)).map((b) => ({ date: b.date, label: b.label, amount: b.amount / 100, type: b.type })),
  };
}
