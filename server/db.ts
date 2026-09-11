import type { DatabaseSync as SqliteDatabase } from "node:sqlite";

// Chargement via process.getBuiltinModule : évite que Vite/Vitest tentent de résoudre « node:sqlite ».
const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
import fs from "node:fs";
import path from "node:path";
import { SEED_CATEGORIES } from "./seed.js";

export type DB = SqliteDatabase;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS wallets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  initial_balance INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  parent_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  icon TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  technical_key TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  date TEXT NOT NULL,
  wallet_id INTEGER NOT NULL REFERENCES wallets(id),
  to_wallet_id INTEGER REFERENCES wallets(id),
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  recurrence_id INTEGER REFERENCES recurrences(id) ON DELETE SET NULL,
  label TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  photo_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_tx_wallet ON transactions(wallet_id);
CREATE TABLE IF NOT EXISTS recurrences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  frequency TEXT NOT NULL,
  day INTEGER NOT NULL,
  wallet_id INTEGER NOT NULL REFERENCES wallets(id),
  to_wallet_id INTEGER REFERENCES wallets(id),
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  next_date TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS budgets (
  category_id INTEGER PRIMARY KEY REFERENCES categories(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  target INTEGER NOT NULL,
  due_date TEXT,
  wallet_id INTEGER NOT NULL REFERENCES wallets(id),
  done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS category_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern TEXT NOT NULL UNIQUE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  wallet_id INTEGER REFERENCES wallets(id) ON DELETE SET NULL,
  hits INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS weekly_advice (
  week TEXT PRIMARY KEY,
  message TEXT NOT NULL,
  insights TEXT NOT NULL,
  generated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bank TEXT NOT NULL,
  wallet_id INTEGER NOT NULL REFERENCES wallets(id),
  file_name TEXT NOT NULL DEFAULT '',
  created_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

/** Migrations additives : colonnes ajoutées après le MVC 1. */
const MIGRATIONS: { table: string; column: string; ddl: string }[] = [
  { table: "transactions", column: "status", ddl: "ALTER TABLE transactions ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed'" },
  { table: "transactions", column: "import_id", ddl: "ALTER TABLE transactions ADD COLUMN import_id INTEGER REFERENCES imports(id) ON DELETE SET NULL" },
];

function migrate(db: DB) {
  for (const m of MIGRATIONS) {
    const cols = db.prepare(`PRAGMA table_info(${m.table})`).all() as unknown as { name: string }[];
    if (!cols.some((c) => c.name === m.column)) db.exec(m.ddl);
  }
}

export function openDb(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  migrate(db);
  seedIfEmpty(db);
  return db;
}

function seedIfEmpty(db: DB) {
  const row = db.prepare("SELECT COUNT(*) AS n FROM categories").get() as { n: number };
  if (row.n > 0) return;
  const insert = db.prepare(
    "INSERT INTO categories (name, kind, parent_id, icon, sort, technical_key) VALUES (?, ?, ?, ?, ?, ?)",
  );
  let sort = 0;
  for (const group of SEED_CATEGORIES) {
    const parent = insert.run(group.name, group.kind, null, group.icon, sort++, group.key ?? null);
    const parentId = Number(parent.lastInsertRowid);
    for (const child of group.children) {
      insert.run(child, group.kind, parentId, null, sort++, null);
    }
  }
  const wallets = db.prepare("SELECT COUNT(*) AS n FROM wallets").get() as { n: number };
  if (wallets.n === 0) {
    const w = db.prepare("INSERT INTO wallets (name, type, initial_balance) VALUES (?, ?, ?)");
    w.run("Compte courant", "courant", 0);
    w.run("Espèces", "especes", 0);
    w.run("Livret", "livret", 0);
  }
}

export function technicalCategoryId(db: DB, key: "transfer" | "adjustment"): number {
  const row = db.prepare("SELECT id FROM categories WHERE technical_key = ?").get(key) as { id: number } | undefined;
  if (!row) throw new Error(`Catégorie technique manquante : ${key}`);
  return row.id;
}
