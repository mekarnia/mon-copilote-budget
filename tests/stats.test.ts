import { describe, expect, it } from "vitest";
import { memDb, catId, walletId } from "./helpers.js";
import { createTransaction } from "../server/services/transactions.js";
import { compareMonths, monthlySeries, stats } from "../server/services/stats.js";

describe("suivi", () => {
  it("construit 12 mois avec revenus, dépenses et taux d'épargne", () => {
    const db = memDb();
    const courant = walletId(db, "Compte courant");
    createTransaction(db, { type: "income", amount: 200000, date: "2026-09-01", walletId: courant, toWalletId: null, categoryId: catId(db, "Salaire"), projectId: null, label: "", note: "" });
    createTransaction(db, { type: "expense", amount: 50000, date: "2026-09-10", walletId: courant, toWalletId: null, categoryId: catId(db, "Supermarché"), projectId: null, label: "", note: "" });
    createTransaction(db, { type: "expense", amount: 30000, date: "2026-08-10", walletId: courant, toWalletId: null, categoryId: catId(db, "Supermarché"), projectId: null, label: "", note: "" });
    const s = monthlySeries(db, "2026-09", 12);
    expect(s).toHaveLength(12);
    expect(s[0].month).toBe("2025-10");
    expect(s[11]).toMatchObject({ month: "2026-09", income: 200000, expense: 50000, saved: 150000, rate: 0.75 });
    expect(s[10].rate).toBeNull();
    const cmp = compareMonths(db, "2026-09");
    expect(cmp[0]).toMatchObject({ name: "Courses", current: 50000, previous: 30000, delta: 20000 });
    const st = stats(db, "2026-09");
    expect(st.savings.current.rate).toBe(0.75);
    expect(st.savings.bestMonth?.month).toBe("2026-09");
  });
});
