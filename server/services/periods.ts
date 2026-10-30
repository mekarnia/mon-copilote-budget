import type { DB } from "../db.js";
import { todayIso } from "../../shared/dates.js";
import {
  bornesLecture, calculerEvitables, calculerPeriode, periodRange,
  type AvoidableStats, type CategorieSuivi, type LigneJour, type PeriodKey, type PeriodStats,
} from "../../shared/suivi.js";

// Les calculs vivent dans shared/suivi.ts, communs avec la version Supabase.
// Ici, SQLite ne fait que fournir les totaux par jour.
export { PERIOD_KEYS, periodRange, templateGoal } from "../../shared/suivi.js";
export type { AvoidableGoal, AvoidableStats, PeriodCategory, PeriodKey, PeriodPoint, PeriodRange, PeriodStats } from "../../shared/suivi.js";

export function lignesJour(db: DB, from: string, to: string): LigneJour[] {
  return db.prepare(`SELECT t.date, t.type, t.category_id, SUM(t.amount) AS total
    FROM transactions t JOIN categories c ON c.id = t.category_id
    WHERE c.technical_key IS NULL AND t.type IN ('expense', 'income') AND t.date BETWEEN ? AND ?
    GROUP BY t.date, t.type, t.category_id`).all(from, to) as unknown as LigneJour[];
}

export function categoriesSuivi(db: DB): CategorieSuivi[] {
  return (db.prepare("SELECT id, name, icon, parent_id, kind, sort, avoidable FROM categories").all() as unknown as (Omit<CategorieSuivi, "avoidable"> & { avoidable: number })[])
    .map((c) => ({ ...c, avoidable: c.avoidable === 1 }));
}

export function periodStats(db: DB, type: "expense" | "income", key: PeriodKey, today = todayIso(), categoryFilter?: { ids: number[] }): PeriodStats {
  const r = periodRange(key, today);
  return calculerPeriode(lignesJour(db, r.prevFrom, r.to), categoriesSuivi(db), type, key, today, categoryFilter?.ids);
}

export function avoidableIds(db: DB): number[] {
  return (db.prepare("SELECT id FROM categories WHERE avoidable = 1").all() as unknown as { id: number }[]).map((r) => r.id);
}

export function avoidableStats(db: DB, key: PeriodKey, today = todayIso()): AvoidableStats {
  const ids = avoidableIds(db);
  const range = periodRange(key, today);
  const project = db.prepare("SELECT name FROM projects WHERE done = 0 ORDER BY due_date IS NULL, due_date, id LIMIT 1").get() as { name: string } | undefined;
  const topLabels = ids.length
    ? (db.prepare(`SELECT t.label, COUNT(*) AS count, SUM(t.amount) AS total, c.name AS categoryName FROM transactions t JOIN categories c ON c.id = t.category_id
        WHERE t.type = 'expense' AND t.label <> '' AND t.date BETWEEN ? AND ? AND (t.category_id IN (${ids.map(() => "?").join(",")}) OR c.parent_id IN (${ids.map(() => "?").join(",")}))
        GROUP BY LOWER(t.label) ORDER BY count DESC, total DESC LIMIT 5`).all(range.from, range.to, ...ids, ...ids) as unknown as AvoidableStats["topLabels"])
    : [];
  const { from, to } = bornesLecture(today);
  return calculerEvitables(lignesJour(db, from, to), categoriesSuivi(db), key, today, project?.name ?? null, topLabels);
}

