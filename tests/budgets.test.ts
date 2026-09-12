import { describe, expect, it } from "vitest";
import { memDb, catId, walletId } from "./helpers.js";
import { createTransaction } from "../server/services/transactions.js";
import { budgetLines, setBudget, statusOf } from "../server/services/budgets.js";
import { createRecurrence } from "../server/services/recurrences.js";
import { homeSummary } from "../server/services/home.js";
import { createProject, contribute } from "../server/services/projects.js";

describe("budgets et accueil", () => {
  it("colore les barres selon le ratio", () => {
    expect(statusOf(0.5, true)).toBe("green");
    expect(statusOf(0.8, true)).toBe("orange");
    expect(statusOf(1.01, true)).toBe("red");
    expect(statusOf(0, false)).toBe("none");
  });

  it("agrège les dépenses des sous-catégories sur la catégorie parente", () => {
    const db = memDb();
    const courant = walletId(db, "Compte courant");
    setBudget(db, catId(db, "Courses"), 40000);
    createTransaction(db, { type: "expense", amount: 25000, date: "2026-09-02", walletId: courant, toWalletId: null, categoryId: catId(db, "Supermarché"), projectId: null, label: "", note: "" });
    createTransaction(db, { type: "expense", amount: 9000, date: "2026-09-03", walletId: courant, toWalletId: null, categoryId: catId(db, "Boulangerie"), projectId: null, label: "", note: "" });
    const courses = budgetLines(db, "2026-09").find((b) => b.categoryName === "Courses")!;
    expect(courses.spent).toBe(34000);
    expect(courses.status).toBe("orange");
  });

  it("calcule le reste à dépenser : revenus - dépenses - factures à venir", () => {
    const db = memDb();
    const courant = walletId(db, "Compte courant");
    createTransaction(db, { type: "income", amount: 250000, date: "2026-09-01", walletId: courant, toWalletId: null, categoryId: catId(db, "Salaire"), projectId: null, label: "", note: "" });
    createTransaction(db, { type: "expense", amount: 60000, date: "2026-09-05", walletId: courant, toWalletId: null, categoryId: catId(db, "Supermarché"), projectId: null, label: "", note: "" });
    createRecurrence(db, { label: "EDF", type: "expense", amount: 7800, frequency: "monthly", day: 20, walletId: courant, toWalletId: null, categoryId: catId(db, "Électricité et gaz"), active: true }, "2026-09-11");
    const home = homeSummary(db, "2026-09", "2026-09-11");
    expect(home.income).toBe(250000);
    expect(home.expense).toBe(60000);
    expect(home.upcomingExpense).toBe(7800);
    expect(home.remaining).toBe(250000 - 60000 - 7800);
    expect(home.byCategory[0].name).toBe("Courses");
  });

  it("suit l'avancement d'un projet et le montant mensuel nécessaire", () => {
    const db = memDb();
    const courant = walletId(db, "Compte courant");
    const livret = walletId(db, "Livret");
    const p = createProject(db, { name: "Vacances", target: 120000, dueDate: "2027-03-11", walletId: livret });
    contribute(db, p.id, 30000, courant, "2026-09-11");
    const after = homeSummary(db, "2026-09", "2026-09-11").projects.find((x) => x.id === p.id)!;
    expect(after.saved).toBe(30000);
    expect(after.remaining).toBe(90000);
    expect(after.monthlyNeeded).toBe(Math.ceil(90000 / 7));
    expect(homeSummary(db, "2026-09", "2026-09-11").expense).toBe(0);
  });
});

describe("contexte d'une opération", () => {
  it("donne les totaux du mois de la sous-catégorie et de la catégorie", async () => {
    const { transactionContext } = await import("../server/services/transactions.js");
    const db = memDb();
    const courant = walletId(db, "Compte courant");
    const t = createTransaction(db, { type: "expense", amount: 4530, date: "2026-09-10", walletId: courant, toWalletId: null, categoryId: catId(db, "Supermarché"), projectId: null, label: "Carrefour", note: "" });
    createTransaction(db, { type: "expense", amount: 6000, date: "2026-09-03", walletId: courant, toWalletId: null, categoryId: catId(db, "Supermarché"), projectId: null, label: "Lidl", note: "" });
    createTransaction(db, { type: "expense", amount: 320, date: "2026-09-11", walletId: courant, toWalletId: null, categoryId: catId(db, "Boulangerie"), projectId: null, label: "", note: "" });
    createTransaction(db, { type: "expense", amount: 9999, date: "2026-08-11", walletId: courant, toWalletId: null, categoryId: catId(db, "Supermarché"), projectId: null, label: "", note: "" });
    const ctx = transactionContext(db, t.id)!;
    expect(ctx.month).toBe("2026-09");
    expect(ctx.parent).toMatchObject({ name: "Courses", total: 10850, count: 3 });
    expect(ctx.subs.map((x) => [x.name, x.total, x.count])).toEqual([["Supermarché", 10530, 2], ["Boulangerie", 320, 1]]);
    expect(ctx.currentId).toBe(catId(db, "Supermarché"));
  });
});
