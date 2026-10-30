/**
 * Le coach sans base de données : constats de la semaine, briefing chiffré pour
 * le chat, budgets suggérés et catalogue des catégories pour l'IA.
 *
 * Mêmes règles que server/services/insights.ts, briefing.ts et budgets.ts, mais
 * à partir de données déjà lues. La version Supabase les lit dans le navigateur
 * puis les confie à la fonction serveur qui parle à l'IA ; les tests vérifient
 * que les deux versions donnent les mêmes résultats.
 */
import type { BudgetLine, Category, Insight, Project, UpcomingBill, Wallet } from "./types.js";
import { addDays, monthBounds, shiftMonth } from "./dates.js";
import { formatCents } from "./money.js";
import { normalizeLabel } from "./libelle.js";
import { DONNEES_NON_FIABLES, texteSur } from "./texte-sur.js";
import type { CategorieSuivi, LigneJour } from "./suivi.js";

/** Une dépense, avec ce qu'il faut pour repérer l'inhabituel et les abonnements. */
export interface DepenseCoach {
  id: number;
  amount: number;
  label: string;
  date: string;
  category_name: string | null;
  /** Catégorie principale ; null si l'opération n'a pas de catégorie. */
  parent: number | null;
  technique: boolean;
  recurrence_id: number | null;
}

export interface DonneesCoach {
  today: string;
  categories: CategorieSuivi[];
  /** Totaux par jour du début du mois M-3 à la fin du mois en cours. */
  lignes: LigneJour[];
  budgetsMois: BudgetLine[];
  budgetsPrecedent: BudgetLine[];
  soldes: Pick<Wallet, "name" | "type" | "balance">[];
  projets: Project[];
  /** Échéances de aujourd'hui à aujourd'hui + 30 jours. */
  echeances: UpcomingBill[];
  /** Dépenses de min(J-90, début de M-3) à la fin du mois en cours. */
  depenses: DepenseCoach[];
  libellesRecurrences: string[];
  /** Versements aux projets des sept derniers jours. */
  versements: { name: string; total: number }[];
}

/** La plus ancienne date dont le coach a besoin. */
export function debutDonnees(today: string): string {
  const m3 = monthBounds(shiftMonth(today.slice(0, 7), -3)).start;
  const j90 = addDays(today, -90);
  return j90 < m3 ? j90 : m3;
}

function totauxMois(lignes: LigneJour[], month: string) {
  const { start, end } = monthBounds(month);
  let income = 0, expense = 0;
  for (const l of lignes) {
    if (l.date < start || l.date > end) continue;
    if (l.type === "income") income += l.total; else expense += l.total;
  }
  return { income, expense };
}

/** Dépenses par catégorie principale sur un mois. */
export function depenseParParent(lignes: LigneJour[], categories: CategorieSuivi[], month: string): Map<number, number> {
  const cats = new Map(categories.map((c) => [c.id, c]));
  const { start, end } = monthBounds(month);
  const out = new Map<number, number>();
  for (const l of lignes) {
    if (l.type !== "expense" || l.date < start || l.date > end) continue;
    const p = cats.get(l.category_id)?.parent_id ?? l.category_id;
    out.set(p, (out.get(p) ?? 0) + l.total);
  }
  return out;
}

/** Analyse déterministe, sans IA : ce sont les faits que le coach commente. */
export function calculerConstats(d: DonneesCoach): Insight[] {
  const out: Insight[] = [];
  const today = d.today;
  const month = today.slice(0, 7);
  const { end } = monthBounds(month);
  const dayOfMonth = Number(today.slice(8, 10));
  const daysInMonth = Number(end.slice(8, 10));
  const elapsed = dayOfMonth / daysInMonth;

  // 1. Dérive de budget : au rythme actuel, la catégorie dépassera son budget.
  for (const b of d.budgetsMois) {
    if (b.amount <= 0 || b.spent === 0) continue;
    const projected = elapsed > 0 ? b.spent / elapsed : b.spent;
    if (b.status === "red") {
      out.push({ kind: "budget_drift", severity: "warning", title: `Budget ${b.categoryName} dépassé`, text: `${formatCents(b.spent)} dépensés pour ${formatCents(b.amount)} prévus.`, amount: b.spent - b.amount, link: "/budgets" });
    } else if (projected > b.amount * 1.15 && dayOfMonth >= 5) {
      out.push({ kind: "budget_drift", severity: "warning", title: `${b.categoryName} file plus vite que prévu`, text: `Au rythme actuel, le mois finirait vers ${formatCents(Math.round(projected))} pour un budget de ${formatCents(b.amount)}.`, amount: Math.round(projected) - b.amount, link: "/budgets" });
    }
  }

  // 2. Dépense inhabituelle : sur les 7 derniers jours, plus de 2 fois la moyenne de la catégorie sur 3 mois, et plus de 2 000 DA.
  const since = addDays(today, -7);
  const classees = d.depenses.filter((x) => x.parent !== null);
  const recentes = classees.filter((x) => !x.technique && x.date >= since && x.date <= today);
  const debut90 = addDays(today, -90), veille = addDays(today, -1);
  for (const r of recentes) {
    if (r.amount < 200000) continue; // 2 000 DA
    const autres = classees.filter((x) => x.parent === r.parent && x.date >= debut90 && x.date <= veille && x.id !== r.id);
    const avg = autres.length ? autres.reduce((s, x) => s + x.amount, 0) / autres.length : null;
    if (autres.length >= 3 && avg && r.amount > avg * 2) {
      out.push({ kind: "unusual_expense", severity: "info", title: `Dépense inhabituelle : ${r.label || r.category_name}`, text: `${formatCents(r.amount)} le ${r.date.slice(8, 10)}/${r.date.slice(5, 7)}, contre ${formatCents(Math.round(avg))} en moyenne en ${r.category_name}.`, amount: r.amount, link: `/transaction/${r.id}` });
    }
  }

  // 3. Abonnement non déclaré : même libellé, montant proche, présent sur 3 mois consécutifs, sans récurrence.
  const m1 = shiftMonth(month, -1), m2 = shiftMonth(month, -2), m3 = shiftMonth(month, -3);
  const debutM3 = monthBounds(m3).start;
  const byLabel = new Map<string, { label: string; months: Set<string>; amounts: number[] }>();
  for (const r of d.depenses) {
    if (r.recurrence_id !== null || !r.label || r.date < debutM3 || r.date > end) continue;
    const k = normalizeLabel(r.label);
    if (k.length < 3) continue;
    const e = byLabel.get(k) ?? { label: r.label, months: new Set<string>(), amounts: [] };
    e.months.add(r.date.slice(0, 7));
    e.amounts.push(r.amount);
    byLabel.set(k, e);
  }
  const declared = new Set(d.libellesRecurrences.map((l) => normalizeLabel(l)));
  for (const [k, e] of byLabel) {
    if (declared.has(k)) continue;
    const consecutive = [m1, m2, m3].filter((m) => e.months.has(m)).length >= 3 || [month, m1, m2].every((m) => e.months.has(m));
    if (!consecutive) continue;
    const min = Math.min(...e.amounts), max = Math.max(...e.amounts);
    if (max > min * 1.15) continue;
    out.push({ kind: "undeclared_recurrence", severity: "info", title: `${e.label} revient chaque mois`, text: `Environ ${formatCents(Math.round(e.amounts.reduce((s, x) => s + x, 0) / e.amounts.length))} par mois. Déclarez-le en récurrence pour le voir venir.`, amount: null, link: "/reglages/recurrences" });
  }

  // 4. Solde bas : un portefeuille ne couvre pas les factures des 7 prochains jours.
  const semaine = addDays(today, 7);
  const due = d.echeances.filter((b) => b.date >= today && b.date <= semaine && b.type === "expense" && b.recurrenceId).reduce((s, b) => s + b.amount, 0);
  for (const w of d.soldes) {
    if (w.type === "courant" && w.balance < due) {
      out.push({ kind: "low_balance", severity: "warning", title: `${w.name} : solde juste`, text: `${formatCents(w.balance)} disponibles pour ${formatCents(due)} de factures cette semaine.`, amount: due - w.balance, link: "/reglages/portefeuilles" });
    } else if (w.balance < 0) {
      out.push({ kind: "low_balance", severity: "warning", title: `${w.name} est à découvert`, text: `Solde ${formatCents(w.balance)}. Pensez à corriger le solde si ce n'est pas le cas réellement.`, amount: -w.balance, link: "/reglages/portefeuilles" });
    }
  }

  // 5. Bonnes nouvelles : projet alimenté cette semaine, budgets tenus le mois dernier, taux d'épargne.
  for (const f of d.versements) out.push({ kind: "project_progress", severity: "good", title: `${formatCents(f.total)} mis de côté pour ${f.name}`, text: "Continuez comme ça, chaque virement compte.", amount: f.total, link: "/projets" });
  for (const p of d.projets) {
    if (p.done && p.saved >= p.target) out.push({ kind: "project_progress", severity: "good", title: `Objectif ${p.name} atteint 🎉`, text: `${formatCents(p.target)} réunis.`, amount: p.target, link: "/projets" });
  }
  if (dayOfMonth <= 7) {
    const all = d.budgetsPrecedent.filter((b) => b.amount > 0);
    const kept = all.filter((b) => b.spent <= b.amount);
    if (all.length > 0 && kept.length === all.length) out.push({ kind: "budget_kept", severity: "good", title: "Tous les budgets tenus le mois dernier", text: `${all.length} budget${all.length > 1 ? "s" : ""} respecté${all.length > 1 ? "s" : ""}. Bravo.`, amount: null, link: "/budgets" });
  }
  const last = totauxMois(d.lignes, m1);
  if (last.income > 0) {
    const rate = (last.income - last.expense) / last.income;
    if (rate >= 0.1) out.push({ kind: "savings", severity: "good", title: `${Math.round(rate * 100)} % de revenus non dépensés le mois dernier`, text: `${formatCents(last.income - last.expense)} de marge. Un virement vers un projet ?`, amount: last.income - last.expense, link: "/projets" });
  }

  const order = { warning: 0, info: 1, good: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 6);
}

/** Message de repli quand il n'y a pas de clé IA : les faits, sans fioriture. */
export function templateMessage(insights: Insight[]): string {
  if (insights.length === 0) return "Semaine calme : rien d'inhabituel, les budgets tiennent. Continuez à saisir vos dépenses au fil de l'eau.";
  const first = insights[0];
  const good = insights.filter((i) => i.severity === "good").length;
  const lead = first.severity === "good" ? "Bonne semaine : " : "Cette semaine, un point à surveiller : ";
  let msg = `${lead}${first.title.toLowerCase()}.`;
  if (insights.length > 1) msg += ` ${insights.length - 1} autre${insights.length > 2 ? "s" : ""} constat${insights.length > 2 ? "s" : ""} ci-dessous${good > 0 && first.severity !== "good" ? ", dont une bonne nouvelle" : ""}.`;
  return msg;
}

/** Dinars entiers, sans décimales ni séparateurs : le modèle n'a pas besoin du reste. */
const da = (cents: number) => String(Math.round(cents / 100));
/** Tout texte du briefing vient d'un relevé ou d'une saisie : il passe par là. */
const t = (s: string, max = 40) => texteSur(s, max);

/** Instantané chiffré de la situation, en texte dense, pour le chat du coach. */
export function briefing(d: DonneesCoach): string {
  const today = d.today;
  const month = today.slice(0, 7);
  const cats = new Map(d.categories.map((c) => [c.id, c]));
  const lines: string[] = [DONNEES_NON_FIABLES, `Date ${today}. Montants en dinars.`];
  if (d.soldes.length > 0) lines.push(`Soldes: ${d.soldes.map((w) => `${t(w.name)} ${da(w.balance)}`).join(", ")}`);
  for (const m of [month, shiftMonth(month, -1), shiftMonth(month, -2)]) {
    const { income, expense } = totauxMois(d.lignes, m);
    const top = [...depenseParParent(d.lignes, d.categories, m)].sort((a, b) => b[1] - a[1]).slice(0, 6);
    const detail = top.map(([id, total]) => `${t(cats.get(id)?.name ?? "")} ${da(total)}`).join(", ");
    lines.push(`${m}: entrées ${da(income)}, sorties ${da(expense)}, marge ${da(income - expense)}${detail ? ` (${detail})` : ""}`);
  }
  const budgets = d.budgetsMois.filter((b) => b.amount > 0);
  if (budgets.length > 0) lines.push(`Budgets ${month} (prévu/dépensé): ${budgets.map((b) => `${t(b.categoryName)} ${da(b.amount)}/${da(b.spent)}`).join(", ")}`);
  if (d.projets.length > 0) {
    lines.push(`Projets: ${d.projets.map((p) => `${t(p.name)} objectif ${da(p.target)}, épargné ${da(p.saved)}${p.dueDate ? `, pour ${p.dueDate}` : ""}${p.monthlyNeeded !== null ? `, ${da(p.monthlyNeeded)}/mois` : ""}`).join(" | ")}`);
  }
  const bills = d.echeances.filter((b) => b.date >= today && b.date <= addDays(today, 30));
  if (bills.length > 0) lines.push(`Échéances 30j: ${bills.map((b) => `${b.date.slice(5)} ${t(b.label)} ${da(b.amount)}`).join(", ")}`);
  // Les dérives de budget et la marge du mois se relisent dans les lignes ci-dessus :
  // ne coûtent leur place que les constats que le modèle ne peut pas recalculer seul.
  const derivable = new Set(["budget_drift", "budget_kept", "savings"]);
  const insights = calculerConstats(d).filter((i) => !derivable.has(i.kind)).slice(0, 3);
  if (insights.length > 0) lines.push(`Constats: ${insights.map((i) => `${t(i.title, 60)} (${t(i.text, 120)})`).join(" ")}`);
  return lines.join("\n");
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

/**
 * Suggestion déterministe pour `month`, à partir des trois mois précédents.
 * `lignes` couvre les mois M-3 à M-1 ; `budgetsPrecedent` est le mois M-1.
 */
export function suggererBudgets(lignes: LigneJour[], categories: CategorieSuivi[], budgetsPrecedent: BudgetLine[], month: string): BudgetSuggestion[] {
  const m1 = shiftMonth(month, -1), m2 = shiftMonth(month, -2), m3 = shiftMonth(month, -3);
  const s1 = depenseParParent(lignes, categories, m1), s2 = depenseParParent(lignes, categories, m2), s3 = depenseParParent(lignes, categories, m3);
  const prevBudgets = new Map(budgetsPrecedent.map((b) => [b.categoryId, b]));
  const parents = categories.filter((c) => c.parent_id === null && c.kind === "expense").sort((a, b) => a.sort - b.sort);
  const out: BudgetSuggestion[] = [];
  for (const c of parents) {
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

/** Le catalogue des catégories et portefeuilles, tel que l'IA le reçoit pour classer. */
export function catalogue(categories: Category[], wallets: Pick<Wallet, "id" | "name" | "type">[]): string {
  const parents = categories.filter((c) => !c.parentId && !c.technicalKey);
  const cats = parents
    .map((p) => {
      const children = categories.filter((c) => c.parentId === p.id).map((c) => `    - ${c.id} : ${c.name}`).join("\n");
      return `  - ${p.id} : ${p.name} (${p.kind === "income" ? "revenu" : "dépense"})\n${children}`;
    })
    .join("\n");
  const ws = wallets.map((w) => `  - ${w.id} : ${w.name} (${w.type})`).join("\n");
  return `Catégories disponibles (utiliser l'identifiant numérique, préférer une sous-catégorie) :\n${cats}\n\nPortefeuilles disponibles :\n${ws}`;
}
