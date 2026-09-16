import { describe, expect, it } from "vitest";
import { memDb } from "./helpers.js";
import { aiUsageSummary, logAiCall } from "../server/services/aiUsage.js";

describe("journal de consommation de l'IA", () => {
  it("applique le tarif de chaque modèle et regroupe par fonction", () => {
    const db = memDb();
    // Opus 5 : 5 $ / 25 $ par million. 1 000 entrée + 400 sortie = 15 000 µ$ = 1,5 cent.
    logAiCall(db, { modele: "claude-opus-5", fonction: "Photo de ticket", entree: 1000, sortie: 400, ms: 900 });
    // Haiku 4.5 : 1 $ / 5 $. 500 + 100 = 1 000 µ$.
    logAiCall(db, { modele: "claude-haiku-4-5", fonction: "Catégorisation", entree: 500, sortie: 100, ms: 120 });
    logAiCall(db, { modele: "claude-haiku-4-5", fonction: "Catégorisation", entree: 500, sortie: 100, ms: 130 });

    const mois = new Date().toISOString().slice(0, 7);
    const r = aiUsageSummary(db, mois);
    expect(r.appels).toBe(3);
    expect(r.entree).toBe(2000);
    expect(r.sortie).toBe(600);
    // 15 000 + 1 000 + 1 000 = 17 000 µ$ = 1,7 cent, arrondi à 2.
    expect(r.centsUsd).toBe(2);
    expect(r.parFonction[0]).toMatchObject({ fonction: "Photo de ticket", appels: 1 });
    expect(r.parFonction.find((f) => f.fonction === "Catégorisation")?.appels).toBe(2);
  });

  it("ne compte que le mois demandé et supporte un modèle inconnu", () => {
    const db = memDb();
    logAiCall(db, { modele: "modele-inconnu", fonction: "Chat du coach", entree: 10, sortie: 10, ms: 10 });
    expect(aiUsageSummary(db, "2020-01").appels).toBe(0);
    expect(aiUsageSummary(db, new Date().toISOString().slice(0, 7)).centsUsd).toBe(0);
  });
});
