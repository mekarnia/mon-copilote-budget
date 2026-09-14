import type { DB } from "../db.js";
import type { HabitSuggestion, TxType } from "../../shared/types.js";
import { addDays, todayIso } from "../../shared/dates.js";
import { normalizeLabel } from "./rules.js";

interface Row { label: string; category_id: number | null; wallet_id: number; payment_method: "card" | "cash" | null; amount: number; date: string }

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function mostCommon<T>(values: T[]): T | null {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | null = null, n = 0;
  for (const [v, c] of counts) if (c > n) { best = v; n = c; }
  return best;
}

/**
 * Habitudes de l'utilisateur : libellés déjà saisis pour une catégorie (ou toutes),
 * classés par fréquence × récence, avec un bonus si le montant saisi est proche du montant habituel.
 */
export function suggestHabits(
  db: DB,
  opts: { type: TxType; categoryId?: number | null; amount?: number | null; limit?: number; today?: string },
): HabitSuggestion[] {
  const today = opts.today ?? todayIso();
  const since = addDays(today, -365);
  const params: (string | number)[] = [opts.type, since];
  let where = "t.type = ? AND t.label <> '' AND t.date >= ? AND c.technical_key IS NULL";
  if (opts.categoryId) {
    where += " AND (t.category_id = ? OR c.parent_id = ? OR c.id = (SELECT parent_id FROM categories WHERE id = ?))";
    params.push(opts.categoryId, opts.categoryId, opts.categoryId);
  }
  const rows = db
    .prepare(`SELECT t.label, t.category_id, t.wallet_id, t.payment_method, t.amount, t.date
      FROM transactions t JOIN categories c ON c.id = t.category_id WHERE ${where} ORDER BY t.date DESC, t.id DESC`)
    .all(...params) as unknown as Row[];

  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = normalizeLabel(r.label);
    if (key.length < 2) continue;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  const [y, m, d] = today.split("-").map(Number);
  const todayMs = Date.UTC(y, m - 1, d);
  const out: HabitSuggestion[] = [];
  for (const items of groups.values()) {
    const last = items[0];
    const [ly, lm, ld] = last.date.split("-").map(Number);
    const days = Math.max(0, (todayMs - Date.UTC(ly, lm - 1, ld)) / 86400000);
    if (items.length < 2) continue; // une habitude, c'est un libellé revu au moins deux fois
    const typical = median(items.map((i) => i.amount));
    let score = items.length * (1 / (1 + days / 60));
    if (opts.amount) {
      // Écart relatif symétrique : 300 DA contre 1 800 DA est aussi éloigné que 1 800 DA contre 300 DA.
      const ratio = Math.abs(opts.amount - typical) / Math.max(1, Math.min(opts.amount, typical));
      if (ratio <= 0.2) score *= 2;
      else if (ratio <= 0.5) score *= 1.3;
      else if (ratio > 1) score *= 0.3; // montant très éloigné de l'habitude : peu probable
    }
    out.push({
      label: last.label,
      count: items.length,
      typicalAmount: typical,
      lastDate: last.date,
      categoryId: mostCommon(items.map((i) => i.category_id)) ?? null,
      walletId: mostCommon(items.map((i) => i.wallet_id)) ?? last.wallet_id,
      paymentMethod: mostCommon(items.map((i) => i.payment_method)) ?? null,
      score,
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 5);
}
