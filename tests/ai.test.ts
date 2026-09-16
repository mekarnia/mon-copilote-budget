import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AiNotConfigured, CLE_VALIDE, expliquerErreurIa, getClient, hasKey, migrateKeyOutOfDb, PlafondIaAtteint, readKey, setKeyFile, writeKey,
} from "../server/services/ai.js";
import { logAiCall } from "../server/services/aiUsage.js";
import { memDb } from "./helpers.js";

const VRAIE_CLE = `sk-ant-${"a".repeat(30)}`;
let dossier = "";
const envDeDepart = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  dossier = fs.mkdtempSync(path.join(os.tmpdir(), "cle-"));
  setKeyFile(path.join(dossier, "cle-ia.txt"));
  delete process.env.ANTHROPIC_API_KEY;
});

afterEach(() => {
  fs.rmSync(dossier, { recursive: true, force: true });
  if (envDeDepart === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = envDeDepart;
});

describe("la clé vit hors de la base", () => {
  it("s'écrit et se relit dans son fichier", () => {
    expect(hasKey()).toBe(false);
    writeKey(VRAIE_CLE);
    expect(readKey()).toBe(VRAIE_CLE);
    expect(hasKey()).toBe(true);
  });

  it("n'est lisible que par son propriétaire", () => {
    writeKey(VRAIE_CLE);
    const mode = fs.statSync(path.join(dossier, "cle-ia.txt")).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("s'efface quand on enregistre une clé vide", () => {
    writeKey(VRAIE_CLE);
    writeKey("");
    expect(readKey()).toBe("");
    expect(fs.existsSync(path.join(dossier, "cle-ia.txt"))).toBe(false);
  });

  it("laisse la variable d'environnement gagner sur le fichier", () => {
    writeKey(VRAIE_CLE);
    process.env.ANTHROPIC_API_KEY = "sk-ant-venue-de-l-environnement";
    expect(readKey()).toBe("sk-ant-venue-de-l-environnement");
  });

  it("quitte la base de données, pour ne plus voyager avec une sauvegarde", () => {
    const db = memDb();
    db.prepare("INSERT INTO settings (key, value) VALUES ('aiKey', ?)").run(VRAIE_CLE);
    migrateKeyOutOfDb(db);
    expect(readKey()).toBe(VRAIE_CLE);
    expect(db.prepare("SELECT value FROM settings WHERE key = 'aiKey'").get()).toBeUndefined();
  });

  it("reconnaît une clé Anthropic et refuse le reste", () => {
    expect(CLE_VALIDE.test(VRAIE_CLE)).toBe(true);
    expect(CLE_VALIDE.test("sk-proj-openai-quelque-chose")).toBe(false);
    expect(CLE_VALIDE.test("sk-ant-court")).toBe(false);
    expect(CLE_VALIDE.test(`sk-ant-${"a".repeat(30)} ; rm -rf /`)).toBe(false);
  });
});

describe("le client refuse d'être créé plutôt que de coûter", () => {
  it("sans clé, dit où la mettre", () => {
    expect(() => getClient(memDb())).toThrow(AiNotConfigured);
  });

  it("plafond atteint, refuse avant l'appel", () => {
    const db = memDb();
    writeKey(VRAIE_CLE);
    db.prepare("INSERT INTO settings (key, value) VALUES ('plafondIaUsd', '0.01')").run();
    logAiCall(db, { modele: "claude-opus-5", fonction: "Test", entree: 100_000, sortie: 0, ms: 1 });
    expect(() => getClient(db)).toThrow(PlafondIaAtteint);
    // Vérifier sa clé doit rester possible : sinon le message d'erreur renvoie
    // vers un écran qui refuse lui aussi de répondre.
    expect(() => getClient(db, { ignorePlafond: true })).not.toThrow();
  });

  it("clé mal formée : le dit, au lieu de laisser l'API répondre 401", () => {
    const db = memDb();
    fs.writeFileSync(path.join(dossier, "cle-ia.txt"), "ma-cle-recopiee-de-travers");
    expect(() => getClient(db)).toThrow(/invalide/);
  });
});

describe("les erreurs de l'API disent quoi faire", () => {
  const cas: [unknown, RegExp][] = [
    [{ status: 401 }, /révoquée ou mal copiée/],
    [{ status: 403 }, /n'a pas le droit/],
    [{ status: 404, message: "model not found" }, /votre compte n'y a pas accès/],
    [{ status: 429 }, /réessayez dans une minute/],
    [{ status: 400, error: { error: { message: "credit balance is too low" } } }, /crédit épuisé/],
    [{ status: 400, error: { error: { message: "max_tokens too large" } } }, /requête refusée/],
    [{ message: "fetch failed" }, /fetch failed/],
  ];
  for (const [erreur, attendu] of cas) {
    it(`explique ${JSON.stringify(erreur).slice(0, 40)}`, () => {
      expect(expliquerErreurIa(erreur)).toMatch(attendu);
    });
  }
});
