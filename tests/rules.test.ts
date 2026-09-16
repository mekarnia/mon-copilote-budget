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

describe("frontières de mot et chiffres", () => {
  it("garde les chiffres collés aux lettres, retire les nombres isolés", () => {
    expect(normalizeLabel("CB M6 BOUTIQUE 12/09")).toBe("m6 boutique");
    expect(normalizeLabel("5ASEC PRESSING 004521")).toBe("5asec pressing");
    // Date et référence de transaction disparaissent : le même commerçant doit se retrouver.
    expect(normalizeLabel("CARREFOUR 12/09")).toBe(normalizeLabel("CARREFOUR 15/10"));
  });

  it("une règle ne capture plus les mots qui la contiennent", () => {
    const db = memDb();
    learnRule(db, "AUTO ECOLE", catId(db, "Divers"), null);
    // « auto » ne doit pas happer autoroute ni automobile.
    expect(matchRule(db, "PEAGE AUTOROUTE A7")).toBeNull();
    expect(matchRule(db, "GARAGE AUTOMOBILE DUPONT")).toBeNull();
    expect(matchRule(db, "AUTO ECOLE DU CENTRE")).not.toBeNull();
  });

  it("retrouve une enseigne de trois lettres, mot entier seulement", () => {
    const db = memDb();
    learnRule(db, "EDF", catId(db, "Électricité et gaz"), null);
    expect(matchRule(db, "PRLV SEPA EDF DU 07/09")).not.toBeNull();
    expect(matchRule(db, "REDFORD SHOP")).toBeNull();
  });
});
