import { describe, expect, it } from "vitest";
import { memDb, catId, walletId } from "./helpers.js";
import { createTransaction } from "../server/services/transactions.js";
import { suggestHabits } from "../server/services/habits.js";

const TODAY = "2026-09-12";

describe("habitudes", () => {
  function seed() {
    const db = memDb();
    const courant = walletId(db, "Compte courant"), especes = walletId(db, "Espèces");
    const resto = catId(db, "Restaurant"), boulangerie = catId(db, "Boulangerie");
    const add = (label: string, amount: number, date: string, cat: number, wallet = courant, pm: "card" | "cash" = "card") =>
      createTransaction(db, { type: "expense", amount, date, walletId: wallet, toWalletId: null, categoryId: cat, projectId: null, label, note: "", paymentMethod: pm }, { learn: false });
    add("Pizza Roma", 1800, "2026-09-05", resto); add("Pizza Roma", 1950, "2026-08-20", resto); add("Pizza Roma", 1700, "2026-07-30", resto);
    add("Le Bistrot", 3200, "2026-09-10", resto); add("Le Bistrot", 3500, "2026-06-01", resto);
    add("Sushi Bar", 4500, "2026-01-10", resto);
    add("Boulangerie du coin", 320, "2026-09-11", boulangerie, especes, "cash"); add("Boulangerie du coin", 310, "2026-09-04", boulangerie, especes, "cash");
    for (const n of ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"]) { add(`Resto ${n}`, 2000, "2026-08-01", resto); add(`Resto ${n}`, 2000, "2026-07-01", resto); }
    return { db, resto, boulangerie, especes };
  }

  it("propose les restaurants habituels pour la catégorie, les plus fréquents et récents d'abord", () => {
    const { db, resto } = seed();
    const s = suggestHabits(db, { type: "expense", categoryId: resto, today: TODAY });
    expect(s.slice(0, 2).map((x) => x.label)).toEqual(["Pizza Roma", "Le Bistrot"]);
    expect(s.map((x) => x.label)).not.toContain("Sushi Bar"); // vu une seule fois
    expect(s).toHaveLength(5); // jamais plus de 5
    expect(s[0].typicalAmount).toBe(1800);
    expect(s[0].count).toBe(3);
  });

  it("fait remonter le libellé dont le montant habituel est proche du montant saisi", () => {
    const { db, resto } = seed();
    const s = suggestHabits(db, { type: "expense", categoryId: resto, amount: 3300, today: TODAY });
    expect(s[0].label).toBe("Le Bistrot");
  });

  it("fonctionne sur la catégorie parente et sans catégorie, avec le contexte habituel", () => {
    const { db, especes } = seed();
    const parent = catId(db, "Courses");
    const s = suggestHabits(db, { type: "expense", categoryId: parent, today: TODAY });
    expect(s[0].label).toBe("Boulangerie du coin");
    expect(s[0].walletId).toBe(especes);
    expect(s[0].paymentMethod).toBe("cash");
    const all = suggestHabits(db, { type: "expense", amount: 320, today: TODAY });
    expect(all[0].label).toBe("Boulangerie du coin");
  });
});
