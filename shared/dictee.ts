/**
 * Lecture instantanée d'une phrase dictée, sans IA.
 *
 * « 1200 dinars de courses chez Ardis hier » contient tout ce qu'il faut : un
 * montant, une catégorie reconnaissable, un commerçant et une date. Le lire ici
 * prend une milliseconde, là où un aller-retour vers un modèle prend plusieurs
 * secondes. L'IA n'intervient que pour ce que cette lecture ne trouve pas.
 */
import type { Category, PaymentMethod, TransactionDraft, TxType, Wallet } from "./types.js";
import { addDays } from "./dates.js";
import { matchBankCategory, normalizeCategoryLabel } from "./banque.js";

export interface ContexteDictee {
  categories: Category[];
  wallets: Pick<Wallet, "id" | "name" | "type">[];
  /** Règles apprises : libellé -> catégorie. */
  regle?: (libelle: string) => { categoryId: number | null; walletId: number | null } | null;
  /** Moyen de paiement d'une dépense quand la phrase n'en dit rien (réglage du foyer). */
  paiementParDefaut?: PaymentMethod | null;
}

export interface LectureDictee {
  draft: TransactionDraft;
  /** Montant et catégorie trouvés : rien à demander à l'IA. */
  complet: boolean;
}

const UNITES: Record<string, number> = {
  zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10,
  onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16, vingt: 20, trente: 30, quarante: 40,
  cinquante: 50, soixante: 60, septante: 70, huitante: 80, nonante: 90,
};

/** « deux mille cinq cents » -> 2500. Les moteurs de dictée écrivent surtout des chiffres, mais pas toujours. */
function nombreEnLettres(mots: string[]): number | null {
  let total = 0, courant = 0, vu = false;
  for (const m of mots) {
    if (m === "et") continue;
    if (m in UNITES) { courant += UNITES[m]; vu = true; }
    else if (m === "cent" || m === "cents") { courant = (courant || 1) * 100; vu = true; }
    else if (m === "mille") { total += (courant || 1) * 1000; courant = 0; vu = true; }
    else if (m === "million" || m === "millions") { total += (courant || 1) * 1_000_000; courant = 0; vu = true; }
    else return null;
  }
  return vu ? total + courant : null;
}

const MOT_MONNAIE = /^(dinars?|da|dzd|euros?|€|balles)$/;

/** Le montant, en centimes : « 1 200 », « 45,50 », « 2 mille », « deux mille cinq cents dinars ». */
function trouverMontant(t: string): { cents: number; debut: number; fin: number } | null {
  // Chiffres, éventuellement suivis de « mille » : « 2 mille », « 1,5 million ».
  const re = /(\d{1,3}(?:[   ]\d{3})+|\d+)(?:[.,](\d{1,2}))?(?:\s*(mille|k|million|millions))?(?:\s*(dinars?|da|dzd|euros?|€))?/gi;
  let meilleur: { cents: number; debut: number; fin: number; score: number } | null = null;
  for (const m of t.matchAll(re)) {
    const entier = Number(m[1].replace(/[   ]/g, ""));
    let valeur = entier + (m[2] ? Number(m[2].padEnd(2, "0")) / 100 : 0);
    const mult = m[3]?.toLowerCase();
    if (mult === "mille" || mult === "k") valeur *= 1000;
    if (mult?.startsWith("million")) valeur *= 1_000_000;
    // Un nombre suivi d'une monnaie est le montant ; « le 5 » est une date, « 2 pains » une quantité.
    const avant = t.slice(Math.max(0, (m.index ?? 0) - 3), m.index).toLowerCase();
    const score = (m[4] ? 3 : 0) + (mult ? 1 : 0) + (/le\s$/.test(avant) ? -3 : 0) + (valeur >= 10 ? 1 : 0);
    if (!meilleur || score > meilleur.score) meilleur = { cents: Math.round(valeur * 100), debut: m.index ?? 0, fin: (m.index ?? 0) + m[0].length, score };
  }
  if (meilleur && meilleur.score >= 0 && meilleur.cents > 0) return meilleur;
  // Sinon, en toutes lettres : la plus longue suite de mots-nombres suivie d'une monnaie.
  const mots = t.toLowerCase().split(/\s+/);
  for (let i = 0; i < mots.length; i++) {
    for (let j = mots.length; j > i; j--) {
      const v = nombreEnLettres(mots.slice(i, j));
      if (v !== null && v > 0 && MOT_MONNAIE.test(mots[j] ?? "")) {
        const debut = t.toLowerCase().indexOf(mots[i]);
        return { cents: v * 100, debut, fin: debut + mots.slice(i, j + 1).join(" ").length };
      }
    }
  }
  return meilleur && meilleur.cents > 0 ? meilleur : null;
}

const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

function trouverDate(t: string, today: string): string {
  const s = t.toLowerCase();
  if (/avant[- ]hier/.test(s)) return addDays(today, -2);
  if (/\bhier\b/.test(s)) return addDays(today, -1);
  const jour = JOURS.findIndex((j) => new RegExp(`\\b${j}\\b`).test(s));
  if (jour >= 0) {
    const auj = new Date(`${today}T12:00:00`).getDay();
    const ecart = (auj - jour + 7) % 7 || 7; // « lundi » dit un mardi : le lundi d'hier, jamais aujourd'hui
    return addDays(today, -ecart);
  }
  const le = s.match(/\ble\s+(\d{1,2})(?:er)?\b(?!\s*(?:dinars?|da|dzd|euros?|mille))/);
  if (le) {
    const d = Number(le[1]);
    if (d >= 1 && d <= 31) {
      const [y, m] = today.split("-").map(Number);
      let date = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      if (date > today) { // le 28, dit le 3 : le mois dernier
        const p = new Date(y, m - 2, d);
        date = `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, "0")}-${String(p.getDate()).padStart(2, "0")}`;
      }
      return date;
    }
  }
  return today;
}

function trouverType(n: string): TxType {
  // « payé » est une dépense ; « ma paie » est un revenu.
  if (/\b(salaire|ma paie|la paie|ma paye|la paye|recu|rembourse|remboursement|gagne|encaisse|prime|vire sur mon compte)\b/.test(n)) return "income";
  return "expense";
}

function trouverPaiement(n: string): PaymentMethod | null {
  if (/\b(especes|espece|liquide|cash|en main propre)\b/.test(n)) return "cash";
  if (/\b(carte|cb|par carte|sans contact|baridimob|edahabia)\b/.test(n)) return "card";
  return null;
}

/** Le commerçant : ce qui suit « chez », sinon ce qui reste une fois montant, date et mots outils retirés. */
function trouverLibelle(t: string, montant: { debut: number; fin: number } | null): string {
  const chez = t.match(/\bchez\s+(.+?)(?:\s+(?:hier|avant-hier|aujourd'hui|ce matin|ce soir|le \d|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|en |par |pour |avec )|[,.]|$)/i);
  if (chez) return capitaliser(chez[1].trim());
  let reste = montant ? t.slice(0, montant.debut) + " " + t.slice(montant.fin) : t;
  reste = reste
    .replace(/\b(j'ai|jai|je|on|a|ai|pay[ée]s?|d[ée]pens[ée]s?|achet[ée]s?|pour|de|des|du|d'|en|par|le|la|les|un|une|au|aux|à|et|hier|avant-hier|aujourd'hui|ce matin|ce soir|carte|cb|esp[eè]ces?|liquide|cash|dinars?|da|dzd|euros?)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return capitaliser(reste.slice(0, 60));
}

const capitaliser = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Une catégorie nommée dans la phrase : « lavage auto », « boulangerie »… les noms du foyer d'abord. */
function categorieNommee(n: string, categories: Category[], type: TxType): number | null {
  const candidates = categories
    .filter((c) => !c.technicalKey && (type === "income" ? c.kind === "income" : c.kind === "expense"))
    .map((c) => ({ c, nom: normalizeCategoryLabel(c.name) }))
    .filter(({ nom }) => nom.length >= 3 && ` ${n} `.includes(` ${nom} `))
    // La plus précise : une sous-catégorie, et le nom le plus long.
    .sort((a, b) => Number(a.c.parentId === null) - Number(b.c.parentId === null) || b.nom.length - a.nom.length);
  return candidates[0]?.c.id ?? null;
}

/** Réglage du foyer : espèces par défaut, carte, ou rien (« aucun »). */
export function paiementParDefaut(valeur: string | null | undefined): PaymentMethod | null {
  if (valeur === "card") return "card";
  if (valeur === "aucun") return null;
  return "cash";
}

/** Espèces -> portefeuille de type espèces ; carte -> compte courant. */
export function portefeuillePour(m: PaymentMethod, wallets: Pick<Wallet, "id" | "type">[]): number | null {
  return wallets.find((w) => (m === "cash" ? w.type === "especes" : w.type === "courant"))?.id ?? null;
}

/** Le moyen de paiement que la phrase nomme explicitement, ou null. */
export function paiementDit(texte: string): PaymentMethod | null {
  return trouverPaiement(normalizeCategoryLabel(texte));
}

export function lireDictee(texte: string, today: string, ctx: ContexteDictee): LectureDictee {
  const t = texte.trim();
  const n = normalizeCategoryLabel(t);
  const montant = trouverMontant(t);
  const type = trouverType(n);
  const paymentMethod = trouverPaiement(n);
  const label = trouverLibelle(t, montant);
  const regle = label ? ctx.regle?.(label) ?? null : null;
  // « courses » nomme la catégorie Courses ; les mots-clés de la banque précisent la sous-catégorie (Supermarché).
  const nommee = categorieNommee(n, ctx.categories, type);
  const parMotCle = matchBankCategory(ctx.categories, type, n, "");
  const parentDe = (id: number | null) => ctx.categories.find((c) => c.id === id)?.parentId ?? null;
  const precise = nommee !== null && parMotCle !== null && parentDe(parMotCle) === nommee ? parMotCle : null;
  const categoryId = regle?.categoryId ?? precise ?? nommee ?? parMotCle;
  // Rien de dit sur le paiement : celui du foyer par défaut (les espèces), même si une règle se souvient d'une carte.
  const paiement = paymentMethod ?? (type === "expense" ? ctx.paiementParDefaut ?? null : null);
  let walletId = regle?.walletId ?? null;
  if (paiement) walletId = portefeuillePour(paiement, ctx.wallets) ?? walletId;
  const draft: TransactionDraft = {
    type, amount: montant?.cents ?? null, date: trouverDate(t, today), label, categoryId, walletId, toWalletId: null,
    paymentMethod: paiement, question: null, source: "voice",
  };
  return { draft, complet: draft.amount !== null && categoryId !== null };
}
