import { describe, expect, it } from "vitest";
import { memDb, catId, walletId } from "./helpers.js";
import { commit, preview } from "../server/services/importer.js";
import { confirmMany, deleteMany, listTransactions, recategorizeMany, countToVerify } from "../server/services/transactions.js";
import { matchRule } from "../server/services/rules.js";
import type { DB } from "../server/db.js";

const CSV = `Date;Libellé;Montant
10/09/2026;CB CARREFOUR MARKET;-45,30
11/09/2026;CB CARREFOUR MARKET;-12,10
12/09/2026;CB BOULANGERIE DUPONT;-3,20
13/09/2026;CB STATION TOTAL;-60,00
`;

async function importe(db: DB): Promise<number[]> {
  const w = walletId(db, "Compte courant");
  const p = preview(db, CSV, w, null);
  await commit(db, { bank: "Ma banque", walletId: w, mapping: p.mapping, csv: CSV, fileName: "r.csv", skipDuplicates: false, autoConfirmKnown: true }, async () => null);
  return listTransactions(db, { status: "to_verify" }).map((t) => t.id);
}

describe("validation en masse des lignes importées", () => {
  it("valide une sélection d'un seul coup et apprend les règles", async () => {
    const db = memDb();
    const ids = await importe(db);
    expect(ids).toHaveLength(4);
    expect(confirmMany(db, ids)).toBe(4);
    expect(countToVerify(db)).toBe(0);
    // Chaque validation vaut apprentissage : le prochain import de ces libellés sera gratuit et déjà validé.
    expect(matchRule(db, "CB CARREFOUR MARKET")).not.toBeNull();
  });

  it("reclasse et valide tout un groupe mal catégorisé", async () => {
    const db = memDb();
    const ids = await importe(db);
    const carburant = catId(db, "Carburant");
    expect(recategorizeMany(db, ids.slice(0, 2), carburant)).toBe(2);
    const done = listTransactions(db, { status: "confirmed" }).filter((t) => t.categoryId === carburant);
    expect(done).toHaveLength(2);
    expect(countToVerify(db)).toBe(2);
  });

  it("supprime une sélection de doublons", async () => {
    const db = memDb();
    const ids = await importe(db);
    expect(deleteMany(db, ids.slice(0, 3))).toBe(3);
    expect(countToVerify(db)).toBe(1);
  });

  it("ignore sans échouer les identifiants inconnus", async () => {
    const db = memDb();
    await importe(db);
    expect(confirmMany(db, [9999])).toBe(0);
    expect(deleteMany(db, [9999])).toBe(0);
    expect(recategorizeMany(db, [9999], catId(db, "Carburant"))).toBe(0);
  });
});
