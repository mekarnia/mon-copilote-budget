import { describe, expect, it } from "vitest";
import { memDb, catId, walletId } from "./helpers.js";
import { createTransaction } from "../server/services/transactions.js";
import { adjustWallet, getWallet, removeWallet } from "../server/services/wallets.js";
import { monthTotals } from "../server/services/home.js";

describe("solde des portefeuilles", () => {
  it("additionne revenus, dépenses et virements", () => {
    const db = memDb();
    const courant = walletId(db, "Compte courant");
    const livret = walletId(db, "Livret");
    db.prepare("UPDATE wallets SET initial_balance = 10000 WHERE id = ?").run(courant);
    createTransaction(db, { type: "income", amount: 200000, date: "2026-09-01", walletId: courant, toWalletId: null, categoryId: catId(db, "Salaire"), projectId: null, label: "Paie", note: "" });
    createTransaction(db, { type: "expense", amount: 4500, date: "2026-09-02", walletId: courant, toWalletId: null, categoryId: catId(db, "Supermarché"), projectId: null, label: "Carrefour", note: "" });
    createTransaction(db, { type: "transfer", amount: 30000, date: "2026-09-03", walletId: courant, toWalletId: livret, categoryId: null, projectId: null, label: "", note: "" });
    expect(getWallet(db, courant)!.balance).toBe(10000 + 200000 - 4500 - 30000);
    expect(getWallet(db, livret)!.balance).toBe(30000);
  });

  it("corrige le solde par un ajustement hors statistiques", () => {
    const db = memDb();
    const courant = walletId(db, "Compte courant");
    createTransaction(db, { type: "expense", amount: 1000, date: "2026-09-02", walletId: courant, toWalletId: null, categoryId: catId(db, "Supermarché"), projectId: null, label: "", note: "" });
    const r = adjustWallet(db, courant, -2500, "2026-09-05");
    expect(r.adjustment).toBe(-1500);
    expect(getWallet(db, courant)!.balance).toBe(-2500);
    expect(monthTotals(db, "2026-09")).toEqual({ income: 0, expense: 1000 });
  });

  it("archive un portefeuille utilisé au lieu de le supprimer", () => {
    const db = memDb();
    const especes = walletId(db, "Espèces");
    expect(removeWallet(db, walletId(db, "Livret"))).toBe("deleted");
    createTransaction(db, { type: "expense", amount: 500, date: "2026-09-02", walletId: especes, toWalletId: null, categoryId: catId(db, "Boulangerie"), projectId: null, label: "", note: "" });
    expect(removeWallet(db, especes)).toBe("archived");
    expect(getWallet(db, especes)!.archived).toBe(true);
  });
});
