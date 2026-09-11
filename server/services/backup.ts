import type { DB } from "../db.js";
import { listTransactions } from "./transactions.js";

const TABLES = ["wallets", "categories", "projects", "recurrences", "imports", "transactions", "budgets", "settings", "category_rules"] as const;

export function exportJson(db: DB): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = { version: [1] };
  for (const t of TABLES) out[t] = db.prepare(`SELECT * FROM ${t}`).all();
  return out;
}

/** Restauration complète : remplace toutes les données par celles du fichier. */
export function importJson(db: DB, data: Record<string, unknown[]>): void {
  db.exec("BEGIN");
  try {
    db.exec("PRAGMA foreign_keys = OFF");
    for (const t of [...TABLES].reverse()) db.exec(`DELETE FROM ${t}`);
    for (const t of TABLES) {
      const rows = (data[t] ?? []) as Record<string, unknown>[];
      for (const row of rows) {
        const cols = Object.keys(row);
        db.prepare(`INSERT INTO ${t} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...cols.map((c) => row[c] as string | number | null));
      }
    }
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    db.exec("PRAGMA foreign_keys = ON");
    throw e;
  }
}

function csvCell(v: string | number | null): string {
  const s = v === null ? "" : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportCsv(db: DB): string {
  const header = ["date", "type", "montant", "categorie", "portefeuille", "vers_portefeuille", "libelle", "note"];
  const lines = listTransactions(db).map((t) =>
    [t.date, t.type, (t.amount / 100).toFixed(2).replace(".", ","), t.categoryName, t.walletName, t.toWalletName, t.label, t.note].map(csvCell).join(";"),
  );
  return "﻿" + [header.join(";"), ...lines].join("\n");
}
