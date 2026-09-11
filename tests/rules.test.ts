import { describe, expect, it } from "vitest";
import { memDb, catId, walletId } from "./helpers.js";
import { learnRule, matchRule, normalizeLabel } from "../server/services/rules.js";
import { createTransaction, updateTransaction } from "../server/services/transactions.js";

describe("règles de catégorisation", () => {
  it("normalise les libellés bancaires", () => {
    expect(normalizeLabel("CB CARREFOUR MARKET 12/09")).toBe("carrefour market");
    expect(normalizeLabel("PRLV SEPA EDF 123456")).toBe("edf");
    expect(normalizeLabel("Boulangerie Dupré")).toBe("boulangerie dupre");
  });

  it("apprend une règle à la saisie et la retrouve sur un libellé proche", () => {
    const db = memDb();
    const courant = walletId(db, "Compte courant");
    createTransaction(db, { type: "expense", amount: 4530, date: "2026-09-10", walletId: courant, toWalletId: null, categoryId: catId(db, "Supermarché"), projectId: null, label: "Carrefour", note: "" });
    expect(matchRule(db, "CB CARREFOUR MARKET 12/09")).toMatchObject({ categoryId: catId(db, "Supermarché"), source: "rule" });
    expect(matchRule(db, "TOTAL ENERGIES")).toBeNull();
  });

  it("une correction remplace la règle précédente", () => {
    const db = memDb();
    const courant = walletId(db, "Compte courant");
    const t = createTransaction(db, { type: "expense", amount: 1200, date: "2026-09-10", walletId: courant, toWalletId: null, categoryId: catId(db, "Restaurant"), projectId: null, label: "Amazon", note: "" });
    updateTransaction(db, t.id, { type: "expense", amount: 1200, date: "2026-09-10", walletId: courant, toWalletId: null, categoryId: catId(db, "Jouets et cadeaux"), projectId: null, label: "Amazon", note: "" });
    expect(matchRule(db, "AMAZON EU SARL")!.categoryId).toBe(catId(db, "Jouets et cadeaux"));
  });

  it("n'apprend rien des récurrences ni des imports", () => {
    const db = memDb();
    const courant = walletId(db, "Compte courant");
    createTransaction(db, { type: "expense", amount: 100, date: "2026-09-10", walletId: courant, toWalletId: null, categoryId: catId(db, "Eau"), projectId: null, label: "Veolia", note: "" }, { learn: false });
    expect(matchRule(db, "Veolia")).toBeNull();
    learnRule(db, "ab", catId(db, "Eau"), null);
    expect(matchRule(db, "ab")).toBeNull();
  });
});
