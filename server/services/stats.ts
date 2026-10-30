import type { DB } from "../db.js";
import { currentMonth, monthBounds, shiftMonth } from "../../shared/dates.js";
import { calculerStats, comparerMois, serieMensuelle } from "../../shared/suivi.js";
import { categoriesSuivi, lignesJour } from "./periods.js";

export type { CategoryCompare, MonthPoint, Stats } from "../../shared/suivi.js";

const lignes = (db: DB, month: string, count: number) => lignesJour(db, monthBounds(shiftMonth(month, -(count - 1))).start, monthBounds(month).end);

/** Série mensuelle sur `count` mois se terminant à `endMonth` (inclus). */
export const monthlySeries = (db: DB, endMonth: string, count = 12) => serieMensuelle(lignes(db, endMonth, count), endMonth, count);

/** Dépenses par catégorie principale : mois courant contre mois précédent. */
export const compareMonths = (db: DB, month: string) => comparerMois(lignes(db, month, 2), categoriesSuivi(db), month);

export const stats = (db: DB, month = currentMonth()) => calculerStats(lignes(db, month, 12), categoriesSuivi(db), month);
