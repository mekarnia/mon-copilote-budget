import type { DB } from "../db.js";
import { addDays, monthBounds, shiftMonth, todayIso } from "../../shared/dates.js";
import { formatCents } from "../../shared/money.js";

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

function totalsByDay(db: DB, type: "expense" | "income", from: string, to: string, categoryFilter?: { ids: number[] }): Map<string, number> {
  const extra = categoryFilter ? ` AND (t.category_id IN (${categoryFilter.ids.map(() => "?").join(",")}) OR c.parent_id IN (${categoryFilter.ids.map(() => "?").join(",")}))` : "";
  const params: (string | number)[] = [type, from, to, ...(categoryFilter ? [...categoryFilter.ids, ...categoryFilter.ids] : [])];
  const rows = db.prepare(`SELECT t.date, SUM(t.amount) AS total FROM transactions t JOIN categories c ON c.id = t.category_id
    WHERE t.type = ? AND c.technical_key IS NULL AND t.date BETWEEN ? AND ?${extra} GROUP BY t.date`).all(...params) as unknown as { date: string; total: number }[];
  return new Map(rows.map((r) => [r.date, r.total]));
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

export function periodStats(db: DB, type: "expense" | "income", key: PeriodKey, today = todayIso(), categoryFilter?: { ids: number[] }): PeriodStats {
  const range = periodRange(key, today);
  const cur = totalsByDay(db, type, range.from, range.to, categoryFilter);
  const prev = totalsByDay(db, type, range.prevFrom, range.prevTo, categoryFilter);
  const points = buildPoints(cur, range.from, range.to, range.granularity);
  const previousPoints = buildPoints(prev, range.prevFrom, range.prevTo, range.granularity);
  const total = points.reduce((s, p) => s + p.value, 0);
  const previousTotal = previousPoints.reduce((s, p) => s + p.value, 0);
  const extra = categoryFilter ? ` AND (t.category_id IN (${categoryFilter.ids.map(() => "?").join(",")}) OR c.parent_id IN (${categoryFilter.ids.map(() => "?").join(",")}))` : "";
  const params: (string | number)[] = [type, range.from, range.to, ...(categoryFilter ? [...categoryFilter.ids, ...categoryFilter.ids] : [])];
  // Par catégorie : parente par défaut ; si un filtre vise des sous-catégories, on liste ces sous-catégories.
  const groupBy = categoryFilter ? "c.id" : "COALESCE(c.parent_id, c.id)";
  const rows = db.prepare(`SELECT ${groupBy} AS gid, SUM(t.amount) AS total FROM transactions t JOIN categories c ON c.id = t.category_id
    WHERE t.type = ? AND c.technical_key IS NULL AND t.date BETWEEN ? AND ?${extra} GROUP BY gid ORDER BY total DESC`).all(...params) as unknown as { gid: number; total: number }[];
  const names = new Map((db.prepare("SELECT id, name, icon, parent_id FROM categories").all() as unknown as { id: number; name: string; icon: string | null; parent_id: number | null }[]).map((c) => [c.id, c]));
  const byCategory = rows.map((r) => {
    const c = names.get(r.gid)!;
    const icon = c.icon ?? (c.parent_id ? names.get(c.parent_id)?.icon ?? null : null);
    return { categoryId: r.gid, name: c.name, icon, total: r.total, share: total > 0 ? r.total / total : 0 };
  });
  return {
    type, range, total, previousTotal,
    deltaPct: previousTotal > 0 ? (total - previousTotal) / previousTotal : null,
    perDay: Math.round(total / Math.max(1, range.days)),
    points, previousPoints, byCategory,
  };
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

export function avoidableIds(db: DB): number[] {
  return (db.prepare("SELECT id FROM categories WHERE avoidable = 1").all() as unknown as { id: number }[]).map((r) => r.id);
}

export function avoidableStats(db: DB, key: PeriodKey, today = todayIso()): AvoidableStats {
  const ids = avoidableIds(db);
  const base = ids.length ? periodStats(db, "expense", key, today, { ids }) : { ...periodStats(db, "expense", key, today), total: 0, previousTotal: 0, deltaPct: null, perDay: 0, points: [], previousPoints: [], byCategory: [] };
  const all = periodStats(db, "expense", key, today);
  const project = db.prepare("SELECT name FROM projects WHERE done = 0 ORDER BY due_date IS NULL, due_date, id LIMIT 1").get() as { name: string } | undefined;
  const topLabels = ids.length
    ? (db.prepare(`SELECT t.label, COUNT(*) AS count, SUM(t.amount) AS total, c.name AS categoryName FROM transactions t JOIN categories c ON c.id = t.category_id
        WHERE t.type = 'expense' AND t.label <> '' AND t.date BETWEEN ? AND ? AND (t.category_id IN (${ids.map(() => "?").join(",")}) OR c.parent_id IN (${ids.map(() => "?").join(",")}))
        GROUP BY LOWER(t.label) ORDER BY count DESC, total DESC LIMIT 5`).all(base.range.from, base.range.to, ...ids, ...ids) as unknown as AvoidableStats["topLabels"])
    : [];
  return { ...base, allExpenses: all.total, shareOfExpenses: all.total > 0 ? base.total / all.total : 0, goal: templateGoal(base, project?.name ?? null, topLabels), avoidableIds: ids, topLabels };
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
