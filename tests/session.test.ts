import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  adressePrivee, creerJeton, definirMotDePasse, jetonValide, motDePasseConfigure, setSessionFile, verifierMotDePasse,
} from "../server/services/session.js";

let dossier = "";
const envDeDepart = process.env.BUDGET_MOT_DE_PASSE;

beforeEach(() => {
  dossier = fs.mkdtempSync(path.join(os.tmpdir(), "acces-"));
  setSessionFile(path.join(dossier, "acces.json"));
  delete process.env.BUDGET_MOT_DE_PASSE;
});

afterEach(() => {
  fs.rmSync(dossier, { recursive: true, force: true });
  if (envDeDepart === undefined) delete process.env.BUDGET_MOT_DE_PASSE;
  else process.env.BUDGET_MOT_DE_PASSE = envDeDepart;
});

describe("mot de passe du foyer", () => {
  it("n'existe pas tant qu'on ne l'a pas choisi", () => {
    expect(motDePasseConfigure()).toBe(false);
    expect(verifierMotDePasse("n'importe quoi")).toBe(false);
  });

  it("accepte le bon et refuse les autres", () => {
    definirMotDePasse("le loyer de janvier");
    expect(motDePasseConfigure()).toBe(true);
    expect(verifierMotDePasse("le loyer de janvier")).toBe(true);
    expect(verifierMotDePasse("le loyer de fevrier")).toBe(false);
    expect(verifierMotDePasse("")).toBe(false);
  });

  it("n'est jamais écrit en clair sur le disque", () => {
    definirMotDePasse("courgette-2026");
    expect(fs.readFileSync(path.join(dossier, "acces.json"), "utf8")).not.toContain("courgette");
  });

  it("n'est lisible que par son propriétaire", () => {
    definirMotDePasse("courgette-2026");
    expect(fs.statSync(path.join(dossier, "acces.json")).mode & 0o777).toBe(0o600);
  });

  it("refuse un mot de passe trop court", () => {
    expect(() => definirMotDePasse("court")).toThrow(/8 caractères/);
  });

  it("se laisse fournir par l'hébergeur, qui l'emporte sur le fichier", () => {
    definirMotDePasse("celui du fichier");
    process.env.BUDGET_MOT_DE_PASSE = "celui de l'hebergeur";
    expect(verifierMotDePasse("celui de l'hebergeur")).toBe(true);
    expect(verifierMotDePasse("celui du fichier")).toBe(false);
  });
});

describe("jeton de connexion", () => {
  it("est accepté sur l'appareil qui l'a obtenu", () => {
    definirMotDePasse("le loyer de janvier");
    expect(jetonValide(creerJeton())).toBe(true);
  });

  it("expire", () => {
    definirMotDePasse("le loyer de janvier");
    const jeton = creerJeton(0);
    expect(jetonValide(jeton, 0)).toBe(true);
    expect(jetonValide(jeton, 91 * 86_400_000)).toBe(false);
  });

  it("ne se fabrique pas en repoussant soi-même la date", () => {
    definirMotDePasse("le loyer de janvier");
    const [expire, signature] = creerJeton(0).split(".");
    const prolonge = `${Number(expire) + 86_400_000}.${signature}`;
    expect(jetonValide(prolonge, 0)).toBe(false);
  });

  it("tombe quand le mot de passe change : changer doit déconnecter", () => {
    definirMotDePasse("le loyer de janvier");
    const jeton = creerJeton();
    definirMotDePasse("le loyer de fevrier");
    expect(jetonValide(jeton)).toBe(false);
  });

  it("refuse tout quand aucun mot de passe n'est configuré", () => {
    expect(jetonValide("1893456000000.abcdef")).toBe(false);
  });

  it("refuse une forme inattendue au lieu de planter", () => {
    definirMotDePasse("le loyer de janvier");
    for (const faux of ["", "sans-point", "abc.def", "...", "9999999999999."]) expect(jetonValide(faux)).toBe(false);
  });
});

describe("réseau de la maison", () => {
  it("reconnaît les adresses privées", () => {
    for (const ip of ["127.0.0.1", "::1", "192.168.1.42", "10.0.0.7", "172.16.5.1", "::ffff:192.168.1.42"]) {
      expect(adressePrivee(ip), ip).toBe(true);
    }
  });

  it("rejette tout le reste, y compris une adresse absente", () => {
    for (const ip of ["8.8.8.8", "172.32.0.1", "192.169.1.1", "1.2.3.4", undefined]) {
      expect(adressePrivee(ip), String(ip)).toBe(false);
    }
  });
});
