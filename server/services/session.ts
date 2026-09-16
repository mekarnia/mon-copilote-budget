import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Un seul mot de passe, pour un seul foyer.
 *
 * Tant que l'application ne sortait pas du réseau de la maison, il n'y avait
 * rien à garder. Sur le web, l'adresse suffit à lire des relevés bancaires et à
 * dépenser un crédit Anthropic. Le mot de passe n'est jamais enregistré : seule
 * son empreinte l'est, et la comparaison se fait en temps constant pour ne pas
 * livrer le mot de passe lettre par lettre à qui mesure les délais.
 */

const DUREE_JOURS = 90;
const SEL_OCTETS = 16;
const CLE_OCTETS = 64;

interface Acces {
  sel: string;
  empreinte: string;
  /** Secret de signature des jetons ; le changer déconnecte tous les appareils. */
  signature: string;
}

let fichierAcces = "";

export function setSessionFile(chemin: string): void {
  fichierAcces = chemin;
}

function lire(): Acces | null {
  try {
    return fichierAcces ? (JSON.parse(fs.readFileSync(fichierAcces, "utf8")) as Acces) : null;
  } catch {
    return null;
  }
}

function empreinteDe(mdp: string, sel: string): string {
  return crypto.scryptSync(mdp.normalize("NFKC"), sel, CLE_OCTETS).toString("hex");
}

/** Le mot de passe donné par l'environnement l'emporte : c'est ainsi qu'un hébergeur le fournit. */
function motDePasseEnvironnement(): string {
  return (process.env.BUDGET_MOT_DE_PASSE ?? "").trim();
}

export function motDePasseConfigure(): boolean {
  return motDePasseEnvironnement() !== "" || lire() !== null;
}

export function definirMotDePasse(mdp: string): void {
  if (!fichierAcces) throw new Error("Emplacement du mot de passe non configuré.");
  if (mdp.trim().length < 8) throw new Error("Le mot de passe doit faire au moins 8 caractères.");
  const sel = crypto.randomBytes(SEL_OCTETS).toString("hex");
  const acces: Acces = {
    sel,
    empreinte: empreinteDe(mdp, sel),
    // Un nouveau secret de signature à chaque changement : changer de mot de
    // passe doit déconnecter les appareils, sinon changer ne sert à rien.
    signature: crypto.randomBytes(32).toString("hex"),
  };
  fs.mkdirSync(path.dirname(fichierAcces), { recursive: true });
  fs.writeFileSync(fichierAcces, JSON.stringify(acces), { mode: 0o600 });
}

/** Comparaison en temps constant : deux chaînes de longueurs différentes ne doivent pas répondre plus vite. */
function memeSecret(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function verifierMotDePasse(mdp: string): boolean {
  const env = motDePasseEnvironnement();
  if (env) return memeSecret(mdp.normalize("NFKC"), env.normalize("NFKC"));
  const acces = lire();
  if (!acces) return false;
  return memeSecret(empreinteDe(mdp, acces.sel), acces.empreinte);
}

/**
 * Secret de signature des jetons. Avec un mot de passe venu de l'environnement,
 * il en dérive : sans fichier, il faut bien le tirer de quelque part, et
 * changer le mot de passe invalide alors les jetons, ce qui est le but.
 */
function secretSignature(): string {
  const env = motDePasseEnvironnement();
  if (env) return crypto.createHash("sha256").update(`jeton:${env}`).digest("hex");
  return lire()?.signature ?? "";
}

export function creerJeton(maintenant = Date.now()): string {
  const expire = maintenant + DUREE_JOURS * 86_400_000;
  const signature = crypto.createHmac("sha256", secretSignature()).update(String(expire)).digest("hex");
  return `${expire}.${signature}`;
}

export function jetonValide(jeton: string | undefined, maintenant = Date.now()): boolean {
  if (!jeton) return false;
  const secret = secretSignature();
  if (!secret) return false;
  const [expire, signature] = jeton.split(".");
  if (!expire || !signature) return false;
  if (!/^\d+$/.test(expire) || Number(expire) < maintenant) return false;
  const attendue = crypto.createHmac("sha256", secret).update(expire).digest("hex");
  return memeSecret(signature, attendue);
}

/** Durée du cookie, en secondes. */
export const DUREE_COOKIE = DUREE_JOURS * 86_400;
export const COOKIE = "copilote_session";

/**
 * Une adresse du réseau local. Sans mot de passe configuré, l'application ne
 * répond qu'à celles-là : mise en ligne par mégarde, elle refuse au lieu de
 * s'ouvrir. Le défaut choisi est celui qui ne perd rien.
 */
export function adressePrivee(ip: string | undefined): boolean {
  if (!ip) return false;
  const h = ip.replace(/^::ffff:/, "");
  return (
    h === "127.0.0.1" ||
    h === "::1" ||
    h === "localhost" ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(h) ||
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(h)
  );
}
