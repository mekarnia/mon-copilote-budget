import { describe, expect, it } from "vitest";
import { memDb, catId, walletId } from "./helpers.js";
import { applyMapping, cancelImport, commit, detectMapping, listImports, parseAmount, parseCsv, parseDate, preview } from "../server/services/importer.js";
import { createTransaction, listTransactions } from "../server/services/transactions.js";

const CSV = `Date;Libellé;Débit;Crédit
10/09/2026;CB CARREFOUR MARKET;45,30;
11/09/2026;PRLV SEPA EDF;78,00;
01/09/2026;VIR SALAIRE SEPTEMBRE;;2 500,00
12/09/2026;"CB BOULANGERIE ""AU BON PAIN""";3,20;
`;

// Format réel d'un export bancaire français : la banque fournit déjà son propre classement.
const CSV_CATEGORISE = `Date operation;Categorie operation;Sous Categorie operation;Libelle operation;Montant operation
10-09-2026;Vie Quotidienne;Alimentation, supermarché;CB CARREFOUR MARKET;-45,30
07-09-2026;Abonnements et Telephonie;Téléphone;PRELEVEMENT MINT ENERGIE;-32,14
01-09-2026;Revenus;Salaires et revenus d'activité;VIR SALAIRE SEPTEMBRE;2500,00
05-09-2026;Zzz;Rubrique inconnue;ACHAT MYSTERE;-10,00
`;

describe("import de relevé", () => {
  it("lit les montants français", () => {
    expect(parseAmount("1 234,56")).toBe(123456);
    expect(parseAmount("-12.50")).toBe(-1250);
    expect(parseAmount("2 500,00 €")).toBe(250000);
    expect(parseAmount("1.234,56")).toBe(123456);
    expect(parseAmount("abc")).toBeNull();
  });

  it("lit les dates selon le format détecté", () => {
    expect(parseDate("10/09/2026", "dmy")).toBe("2026-09-10");
    expect(parseDate("2026-09-10", "ymd")).toBe("2026-09-10");
    expect(parseDate("09/10/26", "mdy")).toBe("2026-09-10");
  });

  it("détecte le séparateur, l'en-tête et les colonnes débit/crédit", () => {
    const table = parseCsv(CSV);
    expect(table[0]).toEqual(["Date", "Libellé", "Débit", "Crédit"]);
    expect(table[4][1]).toBe('CB BOULANGERIE "AU BON PAIN"');
    const mapping = detectMapping(table[0], table.slice(1));
    expect(mapping).toMatchObject({ date: 0, label: 1, amount: null, debit: 2, credit: 3, dateFormat: "dmy" });
    const rows = applyMapping(table.slice(1), mapping);
    expect(rows[0]).toMatchObject({ date: "2026-09-10", amount: -4530, type: "expense", error: null });
    expect(rows[2]).toMatchObject({ date: "2026-09-01", amount: 250000, type: "income" });
  });

  it("reprend le classement de la banque et n'appelle l'IA que pour le reste", async () => {
    const db = memDb();
    const courant = walletId(db, "Compte courant");
    const p = preview(db, CSV_CATEGORISE, courant, null);
    expect(p.mapping).toMatchObject({ date: 0, category: 1, subCategory: 2, label: 3, amount: 4, dateFormat: "dmy" });
    expect(p.rows.map((r) => r.categorySource)).toEqual(["bank", "bank", "bank", "ai"]);

    let appelsIa = 0;
    const batch = await commit(db, { bank: "Ma banque", walletId: courant, mapping: p.mapping, csv: CSV_CATEGORISE, fileName: "releve.csv", skipDuplicates: true, autoConfirmKnown: true }, async () => { appelsIa++; return null; });
    expect(batch.createdCount).toBe(4);
    expect(appelsIa).toBe(1); // seule la ligne que la banque n'a pas classée
    const imported = listTransactions(db, { status: "to_verify" });
    expect(imported.find((t) => t.label.includes("CARREFOUR"))!.categoryName).toBe("Supermarché");
    expect(imported.find((t) => t.label.includes("MINT"))!.categoryName).toBe("Internet et téléphone");
    expect(imported.find((t) => t.label.includes("SALAIRE"))!.categoryName).toBe("Salaire");
    expect(imported.find((t) => t.label.includes("MYSTERE"))!.categoryName).toBe("Divers");
  });

  it("détecte les doublons avec les opérations déjà saisies", () => {
    const db = memDb();
    const courant = walletId(db, "Compte courant");
    createTransaction(db, { type: "expense", amount: 4530, date: "2026-09-09", walletId: courant, toWalletId: null, categoryId: catId(db, "Supermarché"), projectId: null, label: "Carrefour", note: "" });
    const p = preview(db, CSV, courant, null);
    expect(p.rows.map((r) => r.duplicate)).toEqual([true, false, false, false]);
  });

  it("importe en « à vérifier », applique les règles, mémorise la correspondance et s'annule d'un coup", async () => {
    const db = memDb();
    const courant = walletId(db, "Compte courant");
    createTransaction(db, { type: "expense", amount: 1, date: "2026-08-01", walletId: courant, toWalletId: null, categoryId: catId(db, "Électricité et gaz"), projectId: null, label: "EDF", note: "" });
    const p = preview(db, CSV, courant, null);
    const batch = await commit(db, { bank: "Ma banque", walletId: courant, mapping: p.mapping, csv: CSV, fileName: "releve.csv", skipDuplicates: true, autoConfirmKnown: true }, async () => null);
    expect(batch.createdCount).toBe(4);
    // EDF est déjà connu d'une règle apprise : validé d'office, il ne repasse pas par la vérification.
    const confirmed = listTransactions(db, { status: "confirmed" });
    expect(confirmed.find((t) => t.label.includes("EDF"))!.categoryName).toBe("Électricité et gaz");
    const imported = listTransactions(db, { status: "to_verify" });
    expect(imported).toHaveLength(3);
    expect(imported.find((t) => t.label.includes("CARREFOUR"))!.categoryName).toBe("Divers");
    expect(imported.find((t) => t.label.includes("SALAIRE"))!.categoryName).toBe("Autres revenus");
    expect(preview(db, CSV, courant, "ma banque").savedMapping).toBe(true);
    // Un second import du même fichier ne crée rien.
    const again = await commit(db, { bank: "Ma banque", walletId: courant, mapping: p.mapping, csv: CSV, fileName: "releve.csv", skipDuplicates: true, autoConfirmKnown: true }, async () => null);
    expect(again.createdCount).toBe(0);
    expect(cancelImport(db, batch.id)).toBe(4);
    expect(listTransactions(db, { status: "to_verify" })).toHaveLength(0);
    expect(listImports(db)).toHaveLength(1);
  });
});
