import { describe, expect, it } from "vitest";
import { memDb, catId, walletId } from "./helpers.js";
import { createRecurrence, runDueRecurrences, upcomingBills } from "../server/services/recurrences.js";
import { listTransactions } from "../server/services/transactions.js";
import { nextOccurrence } from "../shared/dates.js";

describe("récurrences", () => {
  it("calcule la prochaine occurrence mensuelle bornée à la fin du mois", () => {
    expect(nextOccurrence("monthly", 5, "2026-09-11")).toBe("2026-10-05");
    expect(nextOccurrence("monthly", 5, "2026-09-05")).toBe("2026-09-05");
    expect(nextOccurrence("monthly", 31, "2026-02-01")).toBe("2026-02-28");
    expect(nextOccurrence("weekly", 1, "2026-09-11")).toBe("2026-09-14"); // vendredi -> lundi
  });

  it("crée les opérations dues une seule fois et avance la date", () => {
    const db = memDb();
    const courant = walletId(db, "Compte courant");
    const r = createRecurrence(db, { label: "Loyer", type: "expense", amount: 85000, frequency: "monthly", day: 5, walletId: courant, toWalletId: null, categoryId: catId(db, "Loyer ou crédit"), active: true, startDate: "2026-07-01" }, "2026-07-01");
    expect(r.nextDate).toBe("2026-07-05");
    expect(runDueRecurrences(db, "2026-09-11")).toBe(3); // juillet, août, septembre
    expect(runDueRecurrences(db, "2026-09-11")).toBe(0);
    const txs = listTransactions(db);
    expect(txs.map((t) => t.date).sort()).toEqual(["2026-07-05", "2026-08-05", "2026-09-05"]);
    expect(txs[0].recurrenceId).toBe(r.id);
  });

  it("liste les échéances à venir sur 7 jours", () => {
    const db = memDb();
    const courant = walletId(db, "Compte courant");
    createRecurrence(db, { label: "Cantine", type: "expense", amount: 6000, frequency: "monthly", day: 15, walletId: courant, toWalletId: null, categoryId: catId(db, "École et cantine"), active: true }, "2026-09-11");
    createRecurrence(db, { label: "Piscine", type: "expense", amount: 1200, frequency: "weekly", day: 3, walletId: courant, toWalletId: null, categoryId: catId(db, "Activités"), active: true }, "2026-09-11");
    const bills = upcomingBills(db, "2026-09-11", "2026-09-18");
    expect(bills.map((b) => `${b.date} ${b.label}`)).toEqual(["2026-09-15 Cantine", "2026-09-16 Piscine"]);
  });
});
