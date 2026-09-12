import { describe, expect, it } from "vitest";
import { memDb, catId, walletId } from "./helpers.js";
import { createTransaction } from "../server/services/transactions.js";
import { setBudget } from "../server/services/budgets.js";
import { createProject, contribute } from "../server/services/projects.js";
import { computeInsights } from "../server/services/insights.js";
import { templateMessage, weeklyAdvice } from "../server/services/coach.js";
import { isoWeek } from "../shared/dates.js";

const TODAY = "2026-09-20";

function expense(db: ReturnType<typeof memDb>, amount: number, date: string, cat: string, label = "") {
  createTransaction(db, { type: "expense", amount, date, walletId: walletId(db, "Compte courant"), toWalletId: null, categoryId: catId(db, cat), projectId: null, label, note: "" }, { learn: false });
}

describe("coach", () => {
  it("calcule la semaine ISO", () => {
    expect(isoWeek("2026-09-20")).toBe("2026-W38");
    expect(isoWeek("2026-01-01")).toBe("2026-W01");
  });

  it("détecte une dérive de budget au rythme actuel", () => {
    const db = memDb();
    setBudget(db, catId(db, "Courses"), "2026-09", 40000);
    expense(db, 35000, "2026-09-10", "Supermarché"); // 350 € au 20 du mois -> projection 525 €
    const drift = computeInsights(db, TODAY).find((i) => i.kind === "budget_drift");
    expect(drift).toBeDefined();
    expect(drift!.title).toContain("Courses");
  });

  it("repère une dépense inhabituelle par rapport à la moyenne de la catégorie", () => {
    const db = memDb();
    for (const d of ["2026-07-05", "2026-07-19", "2026-08-02", "2026-08-16"]) expense(db, 4000, d, "Supermarché", "Lidl");
    expense(db, 18000, "2026-09-18", "Supermarché", "Carrefour gros plein");
    const u = computeInsights(db, TODAY).find((i) => i.kind === "unusual_expense");
    expect(u?.title).toContain("Carrefour");
  });

  it("propose de déclarer un abonnement qui revient chaque mois", () => {
    const db = memDb();
    for (const d of ["2026-06-03", "2026-07-03", "2026-08-03"]) expense(db, 1299, d, "Abonnements", "NETFLIX.COM");
    const r = computeInsights(db, TODAY).find((i) => i.kind === "undeclared_recurrence");
    expect(r?.title).toContain("NETFLIX");
  });

  it("félicite quand un projet est alimenté dans la semaine", () => {
    const db = memDb();
    const p = createProject(db, { name: "Vacances", target: 100000, dueDate: null, walletId: walletId(db, "Livret") });
    contribute(db, p.id, 5000, walletId(db, "Compte courant"), "2026-09-18");
    const g = computeInsights(db, TODAY).find((i) => i.kind === "project_progress");
    expect(g?.severity).toBe("good");
    expect(g?.amount).toBe(5000);
  });

  it("met en cache le conseil de la semaine et retombe sur un texte sans IA", async () => {
    const db = memDb();
    const a = await weeklyAdvice(db, { today: TODAY });
    expect(a.week).toBe("2026-W38");
    expect(a.generatedBy).toBe("template");
    expect(a.message.length).toBeGreaterThan(10);
    const b = await weeklyAdvice(db, { today: "2026-09-21" });
    expect(b.createdAt).toBe(a.createdAt);
    expect(templateMessage([])).toContain("calme");
  });
});
