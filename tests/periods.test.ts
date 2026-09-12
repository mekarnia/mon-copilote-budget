import { describe, expect, it } from "vitest";
import { memDb, catId, walletId } from "./helpers.js";
import { createTransaction } from "../server/services/transactions.js";
import { avoidableStats, periodRange, periodStats } from "../server/services/periods.js";

const TODAY = "2026-09-12";
function exp(db: ReturnType<typeof memDb>, amount: number, date: string, cat: string) {
  createTransaction(db, { type: "expense", amount, date, walletId: walletId(db, "Compte courant"), toWalletId: null, categoryId: catId(db, cat), projectId: null, label: "", note: "" }, { learn: false });
}

describe("périodes", () => {
  it("l'objectif de secours ne descend jamais sous la moitié du niveau actuel", () => {
    const db = memDb();
    exp(db, 10000, "2026-09-10", "Restaurant"); exp(db, 1000, "2026-08-01", "Restaurant");
    const a = avoidableStats(db, "1m", TODAY);
    expect(a.goal?.target).toBe(5000);
  });

  it("calcule les bornes et la période précédente", () => {
    expect(periodRange("7d", TODAY)).toMatchObject({ from: "2026-09-06", to: TODAY, prevFrom: "2026-08-30", prevTo: "2026-09-05", granularity: "day", days: 7 });
    expect(periodRange("1m", TODAY)).toMatchObject({ from: "2026-08-14", to: TODAY, prevFrom: "2026-07-15", prevTo: "2026-08-13", days: 30 });
    expect(periodRange("6m", TODAY)).toMatchObject({ from: "2026-04-01", to: TODAY, prevFrom: "2025-10-01", prevTo: "2026-03-31", granularity: "month" });
    expect(periodRange("1y", TODAY)).toMatchObject({ from: "2025-10-01", prevFrom: "2024-10-01", prevTo: "2025-09-30" });
  });

  it("cumule les dépenses par jour et compare à la période précédente", () => {
    const db = memDb();
    exp(db, 1000, "2026-09-10", "Supermarché"); exp(db, 2000, "2026-09-12", "Restaurant"); exp(db, 500, "2026-09-03", "Supermarché");
    const s = periodStats(db, "expense", "7d", TODAY);
    expect(s.total).toBe(3000);
    expect(s.previousTotal).toBe(500);
    expect(s.points).toHaveLength(7);
    expect(s.points[6].cumulative).toBe(3000);
    expect(s.points[4].cumulative).toBe(1000);
    expect(s.byCategory.map((c) => [c.name, c.total])).toEqual([["Sorties et loisirs", 2000], ["Courses", 1000]]);
    expect(s.deltaPct).toBe(5);
  });

  it("regroupe par mois sur 6 M et 1 A", () => {
    const db = memDb();
    exp(db, 1000, "2026-07-10", "Supermarché"); exp(db, 3000, "2026-09-01", "Supermarché");
    const s = periodStats(db, "expense", "6m", TODAY);
    expect(s.points.map((p) => p.label)).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(s.points[3].value).toBe(1000);
    expect(s.points[5].cumulative).toBe(4000);
  });

  it("isole les dépenses évitables et propose un objectif", () => {
    const db = memDb();
    exp(db, 10000, "2026-09-10", "Supermarché"); exp(db, 5000, "2026-09-11", "Restaurant"); exp(db, 2000, "2026-09-12", "Sorties");
    const a = avoidableStats(db, "1m", TODAY);
    expect(a.total).toBe(7000);
    expect(a.allExpenses).toBe(17000);
    expect(a.shareOfExpenses).toBeCloseTo(7000 / 17000);
    expect(a.byCategory.map((c) => c.name)).toEqual(["Restaurant", "Sorties"]);
    expect(a.goal?.target).toBe(5000);
    expect(a.goal?.saving).toBe(2000);
    expect(a.goal?.generatedBy).toBe("template");
    expect(a.goal?.actions.length).toBeGreaterThan(0);
  });
});
