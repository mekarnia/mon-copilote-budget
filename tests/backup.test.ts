import { describe, expect, it } from "vitest";
import { exportCsv, exportJson, importJson } from "../server/services/backup.js";
import { createTransaction, listTransactions } from "../server/services/transactions.js";
import { setBudget } from "../server/services/budgets.js";
import { catId, memDb, walletId } from "./helpers.js";
import type { DB } from "../server/db.js";

/** Un jeu de données minimal mais représentatif : portefeuille, catégorie, budget, opérations. */
function garni(db: DB) {
  const w = walletId(db, "Espèces");
  const c = catId(db, "Courses");
  createTransaction(db, { type: "expense", amount: 250_00, date: "2026-09-10", label: "Carrefour", categoryId: c, walletId: w, projectId: null, toWalletId: null, note: "" });
  createTransaction(db, { type: "income", amount: 90_000_00, date: "2026-09-01", label: "Salaire", categoryId: catId(db, "Revenus"), walletId: w, projectId: null, toWalletId: null, note: "" });
  setBudget(db, c, "2026-09", 30_000_00);
  db.prepare("INSERT INTO settings (key, value) VALUES ('devise', 'DA')").run();
  return { w, c };
}

describe("sauvegarde et restauration", () => {
  it("fait l'aller-retour sans rien perdre", () => {
    const source = memDb();
    garni(source);
    const fichier = exportJson(source);

    const cible = memDb();
    importJson(cible, fichier);

    expect(listTransactions(cible).map((t) => [t.label, t.amount])).toEqual(listTransactions(source).map((t) => [t.label, t.amount]));
    expect(cible.prepare("SELECT COUNT(*) AS n FROM budgets").get()).toEqual({ n: 1 });
    expect((cible.prepare("SELECT value FROM settings WHERE key = 'devise'").get() as { value: string }).value).toBe("DA");
  });

  it("ne laisse jamais sortir la clé IA", () => {
    const db = memDb();
    db.prepare("INSERT INTO settings (key, value) VALUES ('aiKey', 'sk-ant-secret')").run();
    const fichier = exportJson(db);
    expect(JSON.stringify(fichier)).not.toContain("sk-ant-secret");
    expect((fichier.settings as { key: string }[]).some((r) => r.key === "aiKey")).toBe(false);
  });

  it("remplace les données existantes au lieu de s'y ajouter", () => {
    const source = memDb();
    garni(source);
    const cible = memDb();
    garni(cible);
    createTransaction(cible, { type: "expense", amount: 999_00, date: "2026-09-12", label: "À effacer", categoryId: catId(cible, "Courses"), walletId: walletId(cible, "Espèces"), projectId: null, toWalletId: null, note: "" });

    importJson(cible, exportJson(source));

    expect(listTransactions(cible).some((t) => t.label === "À effacer")).toBe(false);
    expect(listTransactions(cible)).toHaveLength(2);
  });

  it("restaure quel que soit l'ordre des lignes, même une sous-catégorie avant sa parente", () => {
    // SQLite ignore « PRAGMA foreign_keys = OFF » dans une transaction : sans
    // defer_foreign_keys, cette sauvegarde-là était refusée en bloc.
    const source = memDb();
    const { c } = garni(source);
    const fichier = exportJson(source);
    fichier.categories = [...(fichier.categories as Record<string, unknown>[])].reverse();
    fichier.transactions = [...(fichier.transactions as Record<string, unknown>[])].reverse();

    const cible = memDb();
    expect(() => importJson(cible, fichier)).not.toThrow();
    expect(listTransactions(cible)).toHaveLength(2);
    expect(cible.prepare("SELECT COUNT(*) AS n FROM categories WHERE id = ?").get(c)).toEqual({ n: 1 });
  });

  it("ignore une colonne inconnue plutôt que d'échouer", () => {
    const source = memDb();
    garni(source);
    const fichier = exportJson(source);
    fichier.transactions = (fichier.transactions as Record<string, unknown>[]).map((r) => ({ ...r, colonne_du_futur: "x" }));

    const cible = memDb();
    expect(() => importJson(cible, fichier)).not.toThrow();
    expect(listTransactions(cible)).toHaveLength(2);
  });

  it("rend les données intactes quand la restauration échoue", () => {
    const db = memDb();
    garni(db);
    const avant = listTransactions(db);
    const fichier = exportJson(db);
    // Une opération dont le portefeuille n'existe nulle part : la sauvegarde est
    // réellement incohérente, et doit être refusée en entier.
    fichier.transactions = [{ id: 99, type: "expense", amount: 100, date: "2026-09-11", wallet_id: 4242 }];

    expect(() => importJson(db, fichier)).toThrow();
    expect(listTransactions(db)).toEqual(avant);
  });
});

describe("export CSV", () => {
  it("protège les cellules qui contiennent le séparateur ou un guillemet", () => {
    const db = memDb();
    createTransaction(db, {
      type: "expense", amount: 1_00, date: "2026-09-10",
      label: 'Café "Le Bon"; coin rue', categoryId: catId(db, "Courses"), walletId: walletId(db, "Espèces"), projectId: null, toWalletId: null, note: "",
    });
    const csv = exportCsv(db);
    expect(csv).toContain('"Café ""Le Bon""; coin rue"');
    // Une ligne d'en-tête, une ligne d'opération : le point-virgule du libellé
    // ne doit pas avoir créé de colonne supplémentaire.
    expect(csv.trim().split("\n")).toHaveLength(2);
  });

  it("commence par la marque d'ordre des octets, qu'Excel attend pour les accents", () => {
    expect(exportCsv(memDb()).startsWith("﻿")).toBe(true);
  });
});
