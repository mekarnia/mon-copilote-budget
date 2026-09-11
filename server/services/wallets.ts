import type { DB } from "../db.js";
import { technicalCategoryId } from "../db.js";
import type { Wallet, WalletInput } from "../../shared/types.js";
import { todayIso } from "../../shared/dates.js";

interface Row { id: number; name: string; type: Wallet["type"]; initial_balance: number; archived: number; balance: number }

const BALANCE_SQL = `
  w.initial_balance
  + COALESCE((SELECT SUM(CASE
      WHEN t.type = 'income' AND t.wallet_id = w.id THEN t.amount
      WHEN t.type = 'expense' AND t.wallet_id = w.id THEN -t.amount
      WHEN t.type = 'transfer' AND t.wallet_id = w.id THEN -t.amount
      WHEN t.type = 'transfer' AND t.to_wallet_id = w.id THEN t.amount
      ELSE 0 END)
    FROM transactions t WHERE (t.wallet_id = w.id OR t.to_wallet_id = w.id) AND t.date <= ?), 0) AS balance`;

function map(r: Row): Wallet {
  return { id: r.id, name: r.name, type: r.type, initialBalance: r.initial_balance, archived: r.archived === 1, balance: r.balance };
}

export function listWallets(db: DB, includeArchived = false, asOf = "9999-12-31"): Wallet[] {
  const rows = db
    .prepare(`SELECT w.id, w.name, w.type, w.initial_balance, w.archived, ${BALANCE_SQL} FROM wallets w ${includeArchived ? "" : "WHERE w.archived = 0"} ORDER BY w.id`)
    .all(asOf) as unknown as Row[];
  return rows.map(map);
}

export function getWallet(db: DB, id: number, asOf = "9999-12-31"): Wallet | null {
  const r = db.prepare(`SELECT w.id, w.name, w.type, w.initial_balance, w.archived, ${BALANCE_SQL} FROM wallets w WHERE w.id = ?`).get(asOf, id) as unknown as Row | undefined;
  return r ? map(r) : null;
}

export function createWallet(db: DB, input: WalletInput): Wallet {
  const res = db.prepare("INSERT INTO wallets (name, type, initial_balance) VALUES (?, ?, ?)").run(input.name, input.type, input.initialBalance);
  return getWallet(db, Number(res.lastInsertRowid))!;
}

export function updateWallet(db: DB, id: number, input: WalletInput): Wallet | null {
  db.prepare("UPDATE wallets SET name = ?, type = ?, initial_balance = ? WHERE id = ?").run(input.name, input.type, input.initialBalance, id);
  return getWallet(db, id);
}

/** Un portefeuille avec des opérations s'archive, sinon il se supprime. */
export function removeWallet(db: DB, id: number): "deleted" | "archived" | "not_found" {
  if (!getWallet(db, id)) return "not_found";
  const used = db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE wallet_id = ? OR to_wallet_id = ?").get(id, id) as { n: number };
  const usedElsewhere = db.prepare("SELECT (SELECT COUNT(*) FROM recurrences WHERE wallet_id = ? OR to_wallet_id = ?) + (SELECT COUNT(*) FROM projects WHERE wallet_id = ?) AS n").get(id, id, id) as { n: number };
  if (used.n === 0 && usedElsewhere.n === 0) {
    db.prepare("DELETE FROM wallets WHERE id = ?").run(id);
    return "deleted";
  }
  db.prepare("UPDATE wallets SET archived = 1 WHERE id = ?").run(id);
  return "archived";
}

/** « Corriger le solde » : l'écart devient une opération d'ajustement, hors statistiques. */
export function adjustWallet(db: DB, id: number, realBalance: number, date = todayIso()): { adjustment: number; wallet: Wallet } {
  const wallet = getWallet(db, id, date);
  if (!wallet) throw new Error("Portefeuille introuvable");
  const diff = realBalance - wallet.balance;
  if (diff !== 0) {
    const cat = technicalCategoryId(db, "adjustment");
    db.prepare("INSERT INTO transactions (type, amount, date, wallet_id, category_id, label) VALUES (?, ?, ?, ?, ?, ?)").run(
      diff > 0 ? "income" : "expense", Math.abs(diff), date, id, cat, "Correction du solde",
    );
  }
  return { adjustment: diff, wallet: getWallet(db, id)! };
}
