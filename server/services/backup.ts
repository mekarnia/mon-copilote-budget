import type { DB } from "../db.js";
import { listTransactions } from "./transactions.js";

/** Clés de réglage qui ne doivent jamais quitter le serveur. */
const SECRETS = new Set(["aiKey"]);

const TABLES = ["wallets", "categories", "projects", "recurrences", "imports", "transactions", "budgets", "settings", "category_rules", "chat_messages", "weekly_advice"] as const;

export function exportJson(db: DB): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = { version: [1] };
  for (const t of TABLES) out[t] = db.prepare(`SELECT * FROM ${t}`).all();
  // Un secret ne se masque pas, il ne sort pas.
  out.settings = (out.settings as { key: string }[]).filter((r) => !SECRETS.has(r.key));
  return out;
}

/**
 * Restauration complète : remplace toutes les données par celles du fichier.
 *
 * « PRAGMA foreign_keys = OFF » était écrit ici, après le BEGIN : SQLite ignore
 * ce réglage à l'intérieur d'une transaction, sans rien dire. La restauration
 * vérifiait donc chaque insertion, ce qu'elle croyait justement ne pas faire —
 * une sous-catégorie enregistrée avant sa catégorie parente faisait échouer la
 * restauration entière. « defer_foreign_keys », lui, s'applique dans une
 * transaction : l'ordre des lignes ne compte plus, et la cohérence est vérifiée
 * une seule fois, sur l'état final. Une sauvegarde réellement incohérente est
 * toujours refusée, et rien n'est perdu.
 */
export function importJson(db: DB, data: Record<string, unknown[]>): void {
  db.exec("BEGIN");
  try {
    db.exec("PRAGMA defer_foreign_keys = ON");
    for (const t of [...TABLES].reverse()) db.exec(`DELETE FROM ${t}`);
    for (const t of TABLES) {
      const rows = (data[t] ?? []) as Record<string, unknown>[];
      const connues = new Set((db.prepare(`PRAGMA table_info(${t})`).all() as unknown as { name: string }[]).map((c) => c.name));
      for (const row of rows) {
        const cols = Object.keys(row).filter((c) => connues.has(c));
        if (cols.length === 0) continue;
        db.prepare(`INSERT INTO ${t} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...cols.map((c) => row[c] as string | number | null));
      }
    }
    db.exec("COMMIT"); // c'est ici que les clés étrangères sont vérifiées
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportCsv(db: DB): string {
  const header = ["date", "heure", "type", "montant", "categorie", "portefeuille", "vers_portefeuille", "moyen_paiement", "libelle", "note"];
  const lines = listTransactions(db).map((t) =>
    [t.date, t.time, t.type, (t.amount / 100).toFixed(2).replace(".", ","), t.categoryName, t.walletName, t.toWalletName, t.paymentMethod === "card" ? "Carte" : t.paymentMethod === "cash" ? "Espèces" : null, t.label, t.note].map(csvCell).join(";"),
  );
  return "﻿" + [header.join(";"), ...lines].join("\n");
}
