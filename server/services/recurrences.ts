import type { DB } from "../db.js";
import type { Recurrence, RecurrenceInput, UpcomingBill } from "../../shared/types.js";
import { addDays, nextOccurrence, todayIso } from "../../shared/dates.js";
import { createTransaction } from "./transactions.js";

interface Row {
  id: number; label: string; type: Recurrence["type"]; amount: number; frequency: Recurrence["frequency"]; day: number;
  wallet_id: number; to_wallet_id: number | null; category_id: number | null; next_date: string; active: number;
  category_name: string | null; wallet_name: string;
}

const SELECT = `SELECT r.*, c.name AS category_name, w.name AS wallet_name FROM recurrences r
  LEFT JOIN categories c ON c.id = r.category_id JOIN wallets w ON w.id = r.wallet_id`;

const map = (r: Row): Recurrence => ({
  id: r.id, label: r.label, type: r.type, amount: r.amount, frequency: r.frequency, day: r.day, walletId: r.wallet_id,
  toWalletId: r.to_wallet_id, categoryId: r.category_id, nextDate: r.next_date, active: r.active === 1,
  categoryName: r.category_name, walletName: r.wallet_name,
});

export function listRecurrences(db: DB): Recurrence[] {
  return (db.prepare(`${SELECT} ORDER BY r.next_date, r.id`).all() as unknown as Row[]).map(map);
}

export function getRecurrence(db: DB, id: number): Recurrence | null {
  const r = db.prepare(`${SELECT} WHERE r.id = ?`).get(id) as unknown as Row | undefined;
  return r ? map(r) : null;
}

export function createRecurrence(db: DB, input: RecurrenceInput, today = todayIso()): Recurrence {
  const next = nextOccurrence(input.frequency, input.day, input.startDate ?? today);
  const res = db
    .prepare("INSERT INTO recurrences (label, type, amount, frequency, day, wallet_id, to_wallet_id, category_id, next_date, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(input.label, input.type, input.amount, input.frequency, input.day, input.walletId, input.toWalletId, input.categoryId, next, input.active ? 1 : 0);
  return getRecurrence(db, Number(res.lastInsertRowid))!;
}

export function updateRecurrence(db: DB, id: number, input: RecurrenceInput, today = todayIso()): Recurrence | null {
  const existing = getRecurrence(db, id);
  if (!existing) return null;
  const changedSchedule = existing.frequency !== input.frequency || existing.day !== input.day || input.startDate;
  const next = changedSchedule ? nextOccurrence(input.frequency, input.day, input.startDate ?? today) : existing.nextDate;
  db.prepare("UPDATE recurrences SET label = ?, type = ?, amount = ?, frequency = ?, day = ?, wallet_id = ?, to_wallet_id = ?, category_id = ?, next_date = ?, active = ? WHERE id = ?")
    .run(input.label, input.type, input.amount, input.frequency, input.day, input.walletId, input.toWalletId, input.categoryId, next, input.active ? 1 : 0, id);
  return getRecurrence(db, id);
}

export function deleteRecurrence(db: DB, id: number): boolean {
  return db.prepare("DELETE FROM recurrences WHERE id = ?").run(id).changes > 0;
}

/** Crée les opérations dues (next_date <= today) et avance next_date. Idempotent. */
export function runDueRecurrences(db: DB, today = todayIso()): number {
  let created = 0;
  for (const r of listRecurrences(db)) {
    if (!r.active) continue;
    let next = r.nextDate;
    let guard = 0;
    while (next <= today && guard++ < 400) {
      createTransaction(db, {
        type: r.type, amount: r.amount, date: next, walletId: r.walletId, toWalletId: r.toWalletId,
        categoryId: r.categoryId, projectId: null, label: r.label, note: "",
      }, { recurrenceId: r.id });
      created++;
      next = nextOccurrence(r.frequency, r.day, addDays(next, 1));
    }
    if (next !== r.nextDate) db.prepare("UPDATE recurrences SET next_date = ? WHERE id = ?").run(next, r.id);
  }
  return created;
}

/** Échéances entre from (inclus) et to (inclus), en déroulant chaque règle active. */
export function upcomingBills(db: DB, from: string, to: string): UpcomingBill[] {
  const out: UpcomingBill[] = [];
  for (const r of listRecurrences(db)) {
    if (!r.active) continue;
    let next = r.nextDate < from ? nextOccurrence(r.frequency, r.day, from) : r.nextDate;
    let guard = 0;
    while (next <= to && guard++ < 60) {
      out.push({ recurrenceId: r.id, label: r.label, amount: r.amount, date: next, type: r.type });
      next = nextOccurrence(r.frequency, r.day, addDays(next, 1));
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
