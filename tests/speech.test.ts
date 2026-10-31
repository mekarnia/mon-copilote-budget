import { afterEach, describe, expect, it, vi } from "vitest";

/** Un faux moteur de reconnaissance, piloté par le test comme Chrome le ferait. */
class FauxMoteur {
  static instances: FauxMoteur[] = [];
  lang = ""; continuous = false; interimResults = false; maxAlternatives = 1;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  arrete = false;
  constructor() { FauxMoteur.instances.push(this); }
  start() {}
  stop() { this.arrete = true; this.onend?.(); }
  abort() { this.arrete = true; }
  dire(...morceaux: [string, boolean][]) {
    this.onresult?.({ resultIndex: 0, results: morceaux.map(([t, f]) => Object.assign([{ transcript: t }], { isFinal: f })) });
  }
}

async function charger() {
  FauxMoteur.instances = [];
  vi.stubGlobal("SpeechRecognition", FauxMoteur);
  vi.resetModules();
  return import("../src/lib/speech");
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("raccord des morceaux de phrase", () => {
  it("ne répète pas une phrase que Chrome renvoie en entier à chaque mot", async () => {
    const { fusionner } = await charger();
    const morceaux = ["1200", "1200 dinars", "1200 dinars de", "1200 dinars de courses"];
    expect(morceaux.reduce(fusionner, "")).toBe("1200 dinars de courses");
  });
  it("recolle sur le chevauchement après une reprise", async () => {
    const { fusionner } = await charger();
    expect(fusionner("1200 dinars de courses", "de courses chez Ardis")).toBe("1200 dinars de courses chez Ardis");
    expect(fusionner("1200 dinars", "chez Ardis")).toBe("1200 dinars chez Ardis");
    expect(fusionner("1200 dinars de courses chez Ardis", "courses")).toBe("1200 dinars de courses chez Ardis");
  });
  it("ignore majuscules et ponctuation en comparant", async () => {
    const { fusionner } = await charger();
    expect(fusionner("1200 dinars de courses.", "De courses chez Ardis")).toBe("1200 dinars de courses. chez Ardis");
  });
});

describe("dictée continue", () => {
  it("ne double pas le texte quand Android répète ses résultats", async () => {
    vi.useFakeTimers();
    const { ecouter } = await charger();
    const fin = vi.fn();
    const auFil = vi.fn();
    ecouter({ auFil, fin })!;
    const m = FauxMoteur.instances[0];
    // Comportement de Chrome Android en mode continu : chaque résultat reprend tout le début.
    m.dire(["1200", true]);
    m.dire(["1200", true], ["1200 dinars", true]);
    m.dire(["1200", true], ["1200 dinars", true], ["1200 dinars de courses", true]);
    m.onend!();
    // Après la reprise, il redit encore la fin.
    FauxMoteur.instances[1].dire(["de courses chez Ardis", true]);
    expect(auFil).toHaveBeenLastCalledWith("1200 dinars de courses chez Ardis");
    vi.advanceTimersByTime(3000);
    expect(fin).toHaveBeenCalledWith("1200 dinars de courses chez Ardis");
  });


  it("reprend quand le navigateur coupe en pleine phrase, et garde tout", async () => {
    vi.useFakeTimers();
    const { ecouter } = await charger();
    const fin = vi.fn();
    ecouter({ auFil: () => undefined, fin })!;
    const m1 = FauxMoteur.instances[0];
    expect(m1.continuous).toBe(true);
    m1.dire(["1200 dinars", true]);
    m1.onend!(); // Chrome s'arrête de lui-même après une hésitation
    expect(FauxMoteur.instances).toHaveLength(2); // l'écoute est repartie
    FauxMoteur.instances[1].dire(["de courses chez Ardis", true], [" hier", false]);
    vi.advanceTimersByTime(2000);
    expect(fin).not.toHaveBeenCalled(); // 2 s de silence : on attend encore
    vi.advanceTimersByTime(600);
    expect(fin).toHaveBeenCalledWith("1200 dinars de courses chez Ardis hier");
  });

  it("termine tout de suite sur « Terminer »", async () => {
    const { ecouter } = await charger();
    const fin = vi.fn();
    const e = ecouter({ auFil: () => undefined, fin })!;
    FauxMoteur.instances[0].dire(["500 dinars de pain", true]);
    e.terminer();
    expect(fin).toHaveBeenCalledTimes(1);
    expect(fin).toHaveBeenCalledWith("500 dinars de pain");
    expect(FauxMoteur.instances).toHaveLength(1); // pas de relance après la fin
  });

  it("ne relance pas quand le micro est refusé", async () => {
    const { ecouter } = await charger();
    const erreur = vi.fn();
    ecouter({ auFil: () => undefined, fin: () => undefined, erreur })!;
    const m = FauxMoteur.instances[0];
    m.onerror!({ error: "not-allowed" });
    m.onend!();
    expect(erreur).toHaveBeenCalledWith(expect.stringMatching(/Micro refusé/));
    expect(FauxMoteur.instances).toHaveLength(1);
  });
});
