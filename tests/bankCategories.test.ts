import { describe, expect, it } from "vitest";
import { memDb, catId } from "./helpers.js";
import { listCategories } from "../server/services/categories.js";
import { matchBankCategory, normalizeCategoryLabel } from "../server/services/bankCategories.js";

describe("classement fourni par la banque", () => {
  const db = memDb();
  const cats = listCategories(db);
  const match = (kind: "expense" | "income", cat: string, sub: string) => matchBankCategory(cats, kind, cat, sub);
  // « Vêtements » existe sous Enfants et sous Perso : on lève l'ambiguïté par le parent.
  const under = (parent: string, child: string) => cats.find((c) => c.name === child && c.parentId === catId(db, parent))!.id;

  it("normalise accents, majuscules et ponctuation", () => {
    expect(normalizeCategoryLabel("Achat multimédia, high-tech")).toBe("achat multimedia high tech");
    expect(normalizeCategoryLabel("Salaires et revenus d'activité")).toBe("salaires et revenus d activite");
  });

  it("traduit les catégories réelles d'un relevé bancaire français", () => {
    expect(match("expense", "Vie Quotidienne", "Alimentation, supermarché")).toBe(catId(db, "Supermarché"));
    expect(match("expense", "Vie Quotidienne", "Habillement")).toBe(under("Perso", "Vêtements"));
    expect(match("expense", "Vie Quotidienne", "Coiffeur, cosmétique, soins")).toBe(catId(db, "Beauté et coiffeur"));
    expect(match("expense", "Vie Quotidienne", "Achats, shopping")).toBe(catId(db, "Divers"));
    expect(match("expense", "Loisirs et Sorties", "Restaurants, bars")).toBe(catId(db, "Restaurant"));
    expect(match("expense", "Abonnements et Telephonie", "Téléphone")).toBe(catId(db, "Internet et téléphone"));
    expect(match("expense", "Logement", "Bricolage et jardinage")).toBe(catId(db, "Entretien et travaux"));
    expect(match("expense", "Banque", "Frais bancaires")).toBe(catId(db, "Frais bancaires"));
    expect(match("expense", "Autres Dépenses", "Assurances")).toBe(catId(db, "Assurances autres"));
    expect(match("income", "Revenus", "Salaires et revenus d'activité")).toBe(catId(db, "Salaire"));
    expect(match("income", "Revenus", "Remboursement")).toBe(catId(db, "Remboursements"));
    expect(match("income", "Revenus", "Virement reçu")).toBe(catId(db, "Autres revenus"));
  });

  it("retombe sur la catégorie principale quand la sous-catégorie n'a pas d'équivalent", () => {
    expect(match("expense", "Logement", "Autres charges")).toBe(catId(db, "Maison"));
    expect(match("expense", "Banque", "Banque - Autres")).toBe(catId(db, "Banque et impôts"));
  });

  it("ne mélange jamais dépense et revenu, et laisse la main à l'IA sinon", () => {
    expect(match("expense", "Revenus", "Remboursement")).toBeNull();
    expect(match("expense", "", "")).toBeNull();
    expect(match("expense", "Zzz", "Libellé inconnu")).toBeNull();
  });
});
