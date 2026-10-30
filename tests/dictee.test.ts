import { describe, expect, it } from "vitest";
import { memDb } from "./helpers.js";
import { listCategories } from "../server/services/categories.js";
import { listWallets } from "../server/services/wallets.js";
import { lireDictee } from "../shared/dictee.js";

const db = memDb();
db.prepare("INSERT INTO categories (name, kind, parent_id, sort) VALUES ('Lavage auto', 'expense', (SELECT id FROM categories WHERE name = 'Transport'), 99)").run();
const categories = listCategories(db);
const wallets = listWallets(db);
const nom = (id: number | null) => categories.find((c) => c.id === id)?.name ?? null;
const portefeuille = (id: number | null) => wallets.find((w) => w.id === id)?.name ?? null;
const TODAY = "2026-10-30"; // un vendredi
const lire = (t: string, regle?: Parameters<typeof lireDictee>[2]["regle"]) => lireDictee(t, TODAY, { categories, wallets, regle });

describe("lecture instantanée d'une dictée", () => {
  const cas: [string, { amount: number | null; categorie: string | null; date?: string; label?: string; type?: string; paiement?: string | null; portefeuille?: string }][] = [
    ["1200 dinars de courses chez Ardis hier", { amount: 120000, categorie: "Supermarché", date: "2026-10-29", label: "Ardis" }],
    ["45,50 DA de pain à la boulangerie", { amount: 4550, categorie: "Boulangerie" }],
    ["J'ai payé 2 mille dinars d'essence en espèces", { amount: 200000, categorie: "Carburant", paiement: "cash", portefeuille: "Espèces" }],
    ["deux mille cinq cents dinars restaurant avec les enfants", { amount: 250000, categorie: "Restaurant" }],
    ["1 500 DA pharmacie avant-hier", { amount: 150000, categorie: "Médecin et pharmacie", date: "2026-10-28" }],
    ["salaire 85000 dinars", { amount: 8500000, categorie: "Salaire", type: "income" }],
    ["3000 dinars lavage auto lundi", { amount: 300000, categorie: "Lavage auto", date: "2026-10-26" }],
    ["coiffeur 800 da par carte le 5", { amount: 80000, categorie: "Beauté et coiffeur", date: "2026-10-05", paiement: "card", portefeuille: "Compte courant" }],
    ["500 dinars le 28", { amount: 50000, categorie: null, date: "2026-10-28" }],
    ["un truc pour la maison", { amount: null, categorie: "Maison" }],
  ];
  for (const [phrase, attendu] of cas) {
    it(phrase, () => {
      const { draft, complet } = lire(phrase);
      expect(draft.amount).toBe(attendu.amount);
      expect(nom(draft.categoryId)).toBe(attendu.categorie);
      if (attendu.date) expect(draft.date).toBe(attendu.date);
      if (attendu.label) expect(draft.label).toBe(attendu.label);
      if (attendu.type) expect(draft.type).toBe(attendu.type);
      if (attendu.paiement !== undefined) expect(draft.paymentMethod).toBe(attendu.paiement);
      if (attendu.portefeuille) expect(portefeuille(draft.walletId)).toBe(attendu.portefeuille);
      expect(complet).toBe(draft.amount !== null && draft.categoryId !== null);
    });
  }

  it("préfère la règle apprise pour un commerçant connu", () => {
    const lavage = categories.find((c) => c.name === "Lavage auto")!.id;
    const { draft, complet } = lire("900 dinars chez Speedy", (l) => (l === "Speedy" ? { categoryId: lavage, walletId: null } : null));
    expect(nom(draft.categoryId)).toBe("Lavage auto");
    expect(complet).toBe(true);
  });

  it("va vite : mille phrases en moins d'une demi-seconde", () => {
    const debut = performance.now();
    for (let i = 0; i < 1000; i++) lire(`${i + 1} dinars de courses chez Ardis hier`);
    expect(performance.now() - debut).toBeLessThan(500);
  });
});

describe("paiement par défaut du foyer", () => {
  const avecDefaut = (t: string) => lireDictee(t, TODAY, { categories, wallets, paiementParDefaut: "cash" }).draft;
  it("met les dépenses en espèces quand la phrase n'en dit rien", () => {
    const d = avecDefaut("1200 dinars de courses chez Ardis");
    expect(d.paymentMethod).toBe("cash");
    expect(portefeuille(d.walletId)).toBe("Espèces");
  });
  it("garde la carte quand on la dit, même avec les espèces par défaut", () => {
    const d = avecDefaut("800 DA coiffeur par carte");
    expect(d.paymentMethod).toBe("card");
    expect(portefeuille(d.walletId)).toBe("Compte courant");
  });
  it("l'emporte sur le portefeuille retenu par une règle", () => {
    const d = lireDictee("900 dinars chez Speedy", TODAY, { categories, wallets, paiementParDefaut: "cash", regle: () => ({ categoryId: categories[1].id, walletId: wallets.find((w) => w.name === "Compte courant")!.id }) }).draft;
    expect(portefeuille(d.walletId)).toBe("Espèces");
  });
  it("ne touche pas aux revenus", () => {
    expect(avecDefaut("salaire 85000 dinars").paymentMethod).toBeNull();
  });
});
