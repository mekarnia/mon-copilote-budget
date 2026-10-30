/**
 * Le coach de la version Supabase (shared/coach.ts) doit dire exactement la même
 * chose que celui de la version PC. On prépare des foyers qui déclenchent chaque
 * constat, puis on compare les deux, texte compris.
 */
import { describe, expect, it } from "vitest";
import { memDb, catId, walletId } from "./helpers.js";
import type { DB } from "../server/db.js";
import { createTransaction } from "../server/services/transactions.js";
import { budgetLines, setBudget, suggestBudgets } from "../server/services/budgets.js";
import { contribute, createProject, listProjects } from "../server/services/projects.js";
import { createRecurrence, upcomingBills } from "../server/services/recurrences.js";
import { listWallets } from "../server/services/wallets.js";
import { computeInsights } from "../server/services/insights.js";
import { financialBriefing } from "../server/services/briefing.js";
import { categoriesSuivi, lignesJour } from "../server/services/periods.js";
import { briefing, calculerConstats, debutDonnees, suggererBudgets, type DonneesCoach } from "../shared/coach.js";
import { addDays, monthBounds, shiftMonth } from "../shared/dates.js";

/** Les données du coach, lues dans SQLite comme le navigateur les lit dans Supabase. */
function donnees(db: DB, today: string): DonneesCoach {
  const month = today.slice(0, 7);
  const fin = monthBounds(month).end;
  const debut = debutDonnees(today);
  return {
    today,
    categories: categoriesSuivi(db),
    lignes: lignesJour(db, monthBounds(shiftMonth(month, -3)).start, fin),
    budgetsMois: budgetLines(db, month),
    budgetsPrecedent: budgetLines(db, shiftMonth(month, -1)),
    soldes: listWallets(db),
    projets: listProjects(db, today),
    echeances: upcomingBills(db, today, addDays(today, 30)),
    depenses: (db.prepare(`SELECT t.id, t.amount, t.label, t.date, c.name AS category_name,
        CASE WHEN c.id IS NULL THEN NULL ELSE COALESCE(c.parent_id, c.id) END AS parent,
        c.technical_key IS NOT NULL AS technique, t.recurrence_id
      FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.type = 'expense' AND t.date BETWEEN ? AND ?`).all(debut, fin) as unknown as (Omit<DonneesCoach["depenses"][number], "technique"> & { technique: number })[])
      .map((x) => ({ ...x, technique: x.technique === 1 })),
    libellesRecurrences: (db.prepare("SELECT label FROM recurrences").all() as unknown as { label: string }[]).map((r) => r.label),
    versements: db.prepare(`SELECT p.name, SUM(t.amount) AS total FROM transactions t JOIN projects p ON p.id = t.project_id
      WHERE t.type = 'transfer' AND t.to_wallet_id = p.wallet_id AND t.date BETWEEN ? AND ? GROUP BY p.id`).all(addDays(today, -7), today) as unknown as { name: string; total: number }[],
  };
}

function foyer(): DB {
  const db = memDb();
  const cc = walletId(db, "Compte courant");
  const dep = (amount: number, date: string, cat: string, label = "", w = cc) =>
    createTransaction(db, { type: "expense", amount, date, walletId: w, toWalletId: null, categoryId: catId(db, cat), projectId: null, label, note: "" }, { learn: false });
  const rev = (amount: number, date: string) =>
    createTransaction(db, { type: "income", amount, date, walletId: cc, toWalletId: null, categoryId: catId(db, "Salaire"), projectId: null, label: "Salaire", note: "" }, { learn: false });
  // Revenus et marge du mois dernier, pour le constat d'épargne.
  rev(500000, "2026-08-01"); rev(500000, "2026-09-01"); rev(500000, "2026-07-01");
  // Budget qui dérive, budget dépassé.
  setBudget(db, catId(db, "Courses"), "2026-09", 40000);
  dep(35000, "2026-09-10", "Supermarché", "CB CARREFOUR 10/09");
  setBudget(db, catId(db, "Transport"), "2026-09", 10000);
  dep(15000, "2026-09-12", "Carburant", "STATION NAFTAL");
  // Dépense inhabituelle : trois petites, puis une grosse cette semaine.
  for (const d of ["2026-07-05", "2026-08-05", "2026-08-25"]) dep(300000, d, "Restaurant", "Restaurant du port");
  dep(900000, "2026-09-18", "Restaurant", "Mariage traiteur");
  // Abonnement non déclaré sur trois mois, et un déclaré.
  for (const d of ["2026-06-15", "2026-07-15", "2026-08-15"]) dep(1999, d, "Abonnements", "NETFLIX.COM");
  for (const d of ["2026-07-03", "2026-08-03", "2026-09-03"]) dep(5000, d, "Internet et téléphone", "DJEZZY");
  createRecurrence(db, { label: "Djezzy", type: "expense", amount: 5000, frequency: "monthly", day: 25, walletId: cc, toWalletId: null, categoryId: catId(db, "Internet et téléphone"), active: true }, "2026-09-20");
  // Projet alimenté cette semaine, projet atteint.
  const p = createProject(db, { name: "Vacances", target: 100000, dueDate: "2027-06-30", walletId: walletId(db, "Livret") });
  contribute(db, p.id, 20000, cc, "2026-09-17");
  const q = createProject(db, { name: "Vélo", target: 10000, dueDate: null, walletId: walletId(db, "Livret") });
  contribute(db, q.id, 10000, cc, "2026-08-01");
  // Espèces à découvert.
  dep(5000, "2026-09-02", "Boulangerie", "Boulangerie", walletId(db, "Espèces"));
  return db;
}

describe("coach partagé : mêmes résultats que la version PC", () => {
  for (const today of ["2026-09-20", "2026-09-04", "2026-10-02", "2026-09-30"]) {
    it(`constats et briefing identiques au ${today}`, () => {
      const db = foyer();
      const d = donnees(db, today);
      const attendus = computeInsights(db, today);
      expect(attendus.length).toBeGreaterThan(2);
      expect(calculerConstats(d)).toEqual(attendus);
      expect(briefing(d)).toBe(financialBriefing(db, today));
    });
  }

  it("couvre chaque sorte de constat au moins une fois", () => {
    const db = foyer();
    // Un foyer sans souci, pour les bonnes nouvelles que les alertes repoussent hors des six premiers constats.
    const calme = memDb();
    const cc = walletId(calme, "Compte courant");
    createTransaction(calme, { type: "income", amount: 500000, date: "2026-08-01", walletId: cc, toWalletId: null, categoryId: catId(calme, "Salaire"), projectId: null, label: "", note: "" }, { learn: false });
    createTransaction(calme, { type: "expense", amount: 100000, date: "2026-08-10", walletId: cc, toWalletId: null, categoryId: catId(calme, "Supermarché"), projectId: null, label: "", note: "" }, { learn: false });
    setBudget(calme, catId(calme, "Courses"), "2026-08", 200000);
    expect(calculerConstats(donnees(calme, "2026-09-03"))).toEqual(computeInsights(calme, "2026-09-03"));
    const sortes = new Set([
      ...["2026-09-20", "2026-10-02"].flatMap((t) => calculerConstats(donnees(db, t)).map((i) => i.kind)),
      ...calculerConstats(donnees(calme, "2026-09-03")).map((i) => i.kind),
    ]);
    expect([...sortes].sort()).toEqual(["budget_drift", "budget_kept", "low_balance", "project_progress", "savings", "undeclared_recurrence", "unusual_expense"].sort());
  });

  it("propose les mêmes budgets", () => {
    const db = foyer();
    for (const mois of ["2026-09", "2026-10"]) {
      const d = donnees(db, `${mois}-15`);
      const lignes = lignesJour(db, monthBounds(shiftMonth(mois, -3)).start, monthBounds(shiftMonth(mois, -1)).end);
      expect(suggererBudgets(lignes, d.categories, budgetLines(db, shiftMonth(mois, -1)), mois)).toEqual(suggestBudgets(db, mois));
    }
  });

  it("reste sobre sur un foyer vide", () => {
    const db = memDb();
    const d = donnees(db, "2026-09-20");
    expect(calculerConstats(d)).toEqual(computeInsights(db, "2026-09-20"));
    expect(briefing(d)).toBe(financialBriefing(db, "2026-09-20"));
  });
});
