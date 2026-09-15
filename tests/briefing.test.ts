import { describe, expect, it } from "vitest";
import { memDb, catId, walletId } from "./helpers.js";
import { createTransaction } from "../server/services/transactions.js";
import { setBudget } from "../server/services/budgets.js";
import { financialBriefing } from "../server/services/briefing.js";

const TODAY = "2026-09-15";

function jeuDeDonnees() {
  const db = memDb();
  const courant = walletId(db, "Compte courant");
  const tx = (type: "expense" | "income", amount: number, date: string, cat: string, label: string) =>
    createTransaction(db, { type, amount, date, walletId: courant, toWalletId: null, categoryId: catId(db, cat), projectId: null, label, note: "" });
  tx("income", 25000000, "2026-09-01", "Salaire", "Salaire septembre");
  tx("expense", 5200000, "2026-09-05", "Supermarché", "Carrefour");
  tx("expense", 3800000, "2026-09-07", "Loyer ou crédit", "Loyer");
  tx("income", 25000000, "2026-08-01", "Salaire", "Salaire août");
  tx("expense", 5800000, "2026-08-05", "Supermarché", "Carrefour");
  setBudget(db, catId(db, "Courses"), "2026-09", 6000000);
  return db;
}

describe("briefing financier envoyé au coach", () => {
  it("tient les faits du mois en quelques lignes", () => {
    const b = financialBriefing(jeuDeDonnees(), TODAY);
    expect(b).toContain("Date 2026-09-15");
    expect(b).toContain("Soldes:");
    // Montants en dinars entiers, sans décimales ni séparateurs.
    expect(b).toContain("2026-09: entrées 250000, sorties 90000, marge 160000");
    expect(b).toContain("2026-08: entrées 250000, sorties 58000, marge 192000");
    expect(b).toContain("Courses 52000");
    expect(b).toContain("Budgets 2026-09 (prévu/dépensé): Courses 60000/52000");
  });

  it("reste bien plus court que le même contenu en JSON", () => {
    const b = financialBriefing(jeuDeDonnees(), TODAY);
    expect(b.length).toBeLessThan(1200);
    expect(b.split("\n").length).toBeLessThan(12);
  });

  it("n'affiche pas les sections vides", () => {
    const b = financialBriefing(memDb(), TODAY);
    expect(b).not.toContain("Projets:");
    expect(b).not.toContain("Budgets");
    expect(b).not.toContain("Échéances");
  });
});
