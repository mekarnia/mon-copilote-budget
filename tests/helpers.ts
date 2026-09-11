import { openDb, type DB } from "../server/db.js";

export function memDb(): DB {
  return openDb(":memory:");
}

export function catId(db: DB, name: string): number {
  const r = db.prepare("SELECT id FROM categories WHERE name = ?").get(name) as { id: number };
  return r.id;
}

export function walletId(db: DB, name: string): number {
  const r = db.prepare("SELECT id FROM wallets WHERE name = ?").get(name) as { id: number };
  return r.id;
}
