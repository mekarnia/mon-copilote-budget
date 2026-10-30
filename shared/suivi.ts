/**
 * Calculs de l'écran Suivi, à partir de totaux par jour et par catégorie.
 *
 * La base (SQLite sur le PC, Postgres sur Supabase) ne fait que sommer les
 * montants par jour ; tout le reste — périodes, cumuls, comparaisons, objectif
 * de dépenses évitables — se calcule ici, de la même façon dans les deux versions.
 */
import { addDays, monthBounds, shiftMonth, todayIso } from "./dates.js";
import { formatCents } from "./money.js";

export type PeriodKey = "7d" | "1m" | "6m" | "1y";
export const PERIOD_KEYS: PeriodKey[] = ["7d", "1m", "6m", "1y"];

export interface PeriodRange { key: PeriodKey; from: string; to: string; prevFrom: string; prevTo: string; granularity: "day" | "month"; days: number }
export interface PeriodPoint { label: string; date: string; value: number; cumulative: number }
export interface PeriodCategory { categoryId: number; name: string; icon: string | null; total: number; share: number }
export interface PeriodStats {
  type: "expense" | "income";
  range: PeriodRange;
  total: number;
  previousTotal: number;
  deltaPct: number | null;
  perDay: number;
  points: PeriodPoint[];
  previousPoints: PeriodPoint[];
  byCategory: PeriodCategory[];
}

export interface AvoidableGoal {
  target: number;
  saving: number;
  projectName: string | null;
  reason: string;
  actions: string[];
  generatedBy: "ai" | "template";
}

export interface AvoidableStats extends PeriodStats {
  allExpenses: number;
  shareOfExpenses: number;
  goal: AvoidableGoal | null;
  avoidableIds: number[];
  /** Libellés les plus fréquents parmi les dépenses évitables de la période, pour des conseils concrets. */
  topLabels: { label: string; count: number; total: number; categoryName: string }[];
}

export interface MonthPoint { month: string; income: number; expense: number; saved: number; rate: number | null }
export interface CategoryCompare { categoryId: number; name: string; icon: string | null; current: number; previous: number; delta: number }
export interface Stats {
  month: string;
  monthly: MonthPoint[];
  compare: CategoryCompare[];
  savings: { current: MonthPoint; previous: MonthPoint; average6Rate: number | null; bestMonth: MonthPoint | null };
}

/** Total d'un jour, d'un sens et d'une catégorie, hors catégories techniques (virements, ajustements). */
export interface LigneJour { date: string; type: "expense" | "income"; category_id: number; total: number }
export interface CategorieSuivi { id: number; name: string; icon: string | null; parent_id: number | null; kind: string; sort: number; avoidable: boolean }

/** Bornes de la période et de la période précédente de même longueur. */
export function periodRange(key: PeriodKey, today = todayIso()): PeriodRange {
  if (key === "7d" || key === "1m") {
    const len = key === "7d" ? 7 : 30;
    const from = addDays(today, -(len - 1));
    return { key, from, to: today, prevFrom: addDays(from, -len), prevTo: addDays(from, -1), granularity: "day", days: len };
  }
  const months = key === "6m" ? 6 : 12;
  const month = today.slice(0, 7);
  const from = monthBounds(shiftMonth(month, -(months - 1))).start;
  const prevTo = addDays(from, -1);
  const prevFrom = monthBounds(shiftMonth(month, -(2 * months - 1))).start;
  const days = Math.round((Date.parse(today) - Date.parse(from)) / 86400000) + 1;
  return { key, from, to: today, prevFrom, prevTo, granularity: "month", days };
}

/** La période la plus large dont l'écran peut avoir besoin : 1 an et l'année d'avant. */
export function bornesLecture(today = todayIso()): { from: string; to: string } {
  return { from: periodRange("1y", today).prevFrom, to: today };
}

function filtrer(lignes: LigneJour[], type: "expense" | "income", from: string, to: string, cats: Map<number, CategorieSuivi>, ids?: number[]) {
  const garde = ids ? new Set(ids) : null;
  return lignes.filter((l) => {
    if (l.type !== type || l.date < from || l.date > to) return false;
    if (!garde) return true;
    return garde.has(l.category_id) || garde.has(cats.get(l.category_id)?.parent_id ?? -1);
  });
}

function parJour(lignes: LigneJour[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lignes) m.set(l.date, (m.get(l.date) ?? 0) + l.total);
  return m;
}

function buildPoints(byDay: Map<string, number>, from: string, to: string, granularity: "day" | "month"): PeriodPoint[] {
  const points: PeriodPoint[] = [];
  let cumulative = 0;
  if (granularity === "day") {
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const v = byDay.get(d) ?? 0;
      cumulative += v;
      points.push({ label: d.slice(8, 10), date: d, value: v, cumulative });
    }
  } else {
    const perMonth = new Map<string, number>();
    for (const [d, v] of byDay) perMonth.set(d.slice(0, 7), (perMonth.get(d.slice(0, 7)) ?? 0) + v);
    for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = shiftMonth(m, 1)) {
      const v = perMonth.get(m) ?? 0;
      cumulative += v;
      points.push({ label: m, date: `${m}-01`, value: v, cumulative });
    }
  }
  return points;
}

export function calculerPeriode(
  lignes: LigneJour[], categories: CategorieSuivi[], type: "expense" | "income", key: PeriodKey, today = todayIso(), ids?: number[],
): PeriodStats {
  const cats = new Map(categories.map((c) => [c.id, c]));
  const range = periodRange(key, today);
  const cur = filtrer(lignes, type, range.from, range.to, cats, ids);
  const prev = filtrer(lignes, type, range.prevFrom, range.prevTo, cats, ids);
  const points = buildPoints(parJour(cur), range.from, range.to, range.granularity);
  const previousPoints = buildPoints(parJour(prev), range.prevFrom, range.prevTo, range.granularity);
  const total = points.reduce((s, p) => s + p.value, 0);
  const previousTotal = previousPoints.reduce((s, p) => s + p.value, 0);
  // Par catégorie : parente par défaut ; si un filtre vise des sous-catégories, on liste ces sous-catégories.
  const groupes = new Map<number, number>();
  for (const l of cur) {
    const gid = ids ? l.category_id : cats.get(l.category_id)?.parent_id ?? l.category_id;
    groupes.set(gid, (groupes.get(gid) ?? 0) + l.total);
  }
  const byCategory = [...groupes].sort((a, b) => b[1] - a[1]).map(([gid, t]) => {
    const c = cats.get(gid)!;
    const icon = c.icon ?? (c.parent_id ? cats.get(c.parent_id)?.icon ?? null : null);
    return { categoryId: gid, name: c.name, icon, total: t, share: total > 0 ? t / total : 0 };
  });
  return {
    type, range, total, previousTotal,
    deltaPct: previousTotal > 0 ? (total - previousTotal) / previousTotal : null,
    perDay: Math.round(total / Math.max(1, range.days)),
    points, previousPoints, byCategory,
  };
}

export function calculerEvitables(
  lignes: LigneJour[], categories: CategorieSuivi[], key: PeriodKey, today: string, projectName: string | null, topLabels: AvoidableStats["topLabels"],
): AvoidableStats {
  const ids = categories.filter((c) => c.avoidable).map((c) => c.id);
  const all = calculerPeriode(lignes, categories, "expense", key, today);
  const base = ids.length
    ? calculerPeriode(lignes, categories, "expense", key, today, ids)
    : { ...all, total: 0, previousTotal: 0, deltaPct: null, perDay: 0, points: [], previousPoints: [], byCategory: [] };
  return { ...base, allExpenses: all.total, shareOfExpenses: all.total > 0 ? base.total / all.total : 0, goal: templateGoal(base, projectName, topLabels), avoidableIds: ids, topLabels };
}

/** Objectif de secours, sans IA : la meilleure période récente sinon 80 %, jamais sous 50 % du niveau actuel. */
export function templateGoal(base: PeriodStats, projectName: string | null, topLabels: AvoidableStats["topLabels"]): AvoidableGoal | null {
  if (base.total <= 0) return null;
  const candidates = [base.total * 0.8];
  if (base.previousTotal > 0) candidates.push(base.previousTotal);
  let target = Math.floor(Math.min(...candidates) / 10000) * 10000;
  target = Math.max(target, Math.floor((base.total * 0.5) / 10000) * 10000);
  if (target <= 0 || target >= base.total) return null;
  const actions: string[] = [];
  const top = topLabels[0];
  if (top && top.count >= 2) actions.push(`${top.label} revient ${top.count} fois (${formatCents(top.total)}) : en garder ${Math.max(1, top.count - 1)}.`);
  const cat = base.byCategory[0];
  if (cat) actions.push(`${cat.name} pèse ${Math.round(cat.share * 100)} % des dépenses évitables : c'est là que l'effort compte.`);
  const reason = base.previousTotal > 0 && base.previousTotal < base.total
    ? `Vous aviez tenu ${formatCents(base.previousTotal)} sur la période précédente.`
    : "Une baisse de 20 % reste tenable sans changer vos habitudes de fond.";
  return { target, saving: base.total - target, projectName, reason, actions, generatedBy: "template" };
}

/** Totaux d'un mois, hors catégories techniques. */
function totauxMois(lignes: LigneJour[], month: string) {
  const { start, end } = monthBounds(month);
  let income = 0, expense = 0;
  for (const l of lignes) {
    if (l.date < start || l.date > end) continue;
    if (l.type === "income") income += l.total; else expense += l.total;
  }
  return { income, expense };
}

export function serieMensuelle(lignes: LigneJour[], endMonth: string, count = 12): MonthPoint[] {
  const out: MonthPoint[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const month = shiftMonth(endMonth, -i);
    const { income, expense } = totauxMois(lignes, month);
    const saved = income - expense;
    out.push({ month, income, expense, saved, rate: income > 0 ? saved / income : null });
  }
  return out;
}

/** Dépenses par catégorie principale : mois courant contre mois précédent. */
export function comparerMois(lignes: LigneJour[], categories: CategorieSuivi[], month: string): CategoryCompare[] {
  const cats = new Map(categories.map((c) => [c.id, c]));
  const totaux = (m: string) => {
    const { start, end } = monthBounds(m);
    const out = new Map<number, number>();
    for (const l of lignes) {
      if (l.type !== "expense" || l.date < start || l.date > end) continue;
      const p = cats.get(l.category_id)?.parent_id ?? l.category_id;
      out.set(p, (out.get(p) ?? 0) + l.total);
    }
    return out;
  };
  const cur = totaux(month), pre = totaux(shiftMonth(month, -1));
  return categories
    .filter((c) => c.parent_id === null && c.kind === "expense")
    .sort((a, b) => a.sort - b.sort)
    .map((c) => ({ categoryId: c.id, name: c.name, icon: c.icon, current: cur.get(c.id) ?? 0, previous: pre.get(c.id) ?? 0, delta: (cur.get(c.id) ?? 0) - (pre.get(c.id) ?? 0) }))
    .filter((c) => c.current > 0 || c.previous > 0)
    .sort((a, b) => b.current - a.current);
}

export function calculerStats(lignes: LigneJour[], categories: CategorieSuivi[], month: string): Stats {
  const monthly = serieMensuelle(lignes, month, 12);
  const current = monthly[monthly.length - 1];
  const previous = monthly[monthly.length - 2];
  const last6 = monthly.slice(-6).filter((m) => m.rate !== null);
  const average6Rate = last6.length ? last6.reduce((s, m) => s + (m.rate ?? 0), 0) / last6.length : null;
  const withIncome = monthly.filter((m) => m.income > 0);
  const bestMonth = withIncome.length ? withIncome.reduce((a, b) => ((b.rate ?? -1) > (a.rate ?? -1) ? b : a)) : null;
  return { month, monthly, compare: comparerMois(lignes, categories, month), savings: { current, previous, average6Rate, bestMonth } };
}
