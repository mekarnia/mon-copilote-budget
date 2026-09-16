import type { DB } from "../db.js";
import { currentMonth } from "../../shared/dates.js";

/**
 * Deux garde-fous distincts : le débit, qui protège la machine, et le plafond
 * mensuel, qui protège la facture. Le second n'était pas possible avant le
 * journal de consommation : on ne peut pas plafonner ce qu'on ne mesure pas.
 */

/** Fenêtre glissante par appelant, en mémoire : un serveur, un foyer. */
export class Limiteur {
  private vus = new Map<string, number[]>();

  constructor(private readonly max: number, private readonly fenetreMs: number) {}

  /** Consomme un jeton. Faux quand l'appelant a dépassé sa fenêtre. */
  autorise(cle: string, maintenant = Date.now()): boolean {
    const depuis = maintenant - this.fenetreMs;
    const recents = (this.vus.get(cle) ?? []).filter((t) => t > depuis);
    // Sans ce ménage, une adresse vue une fois occupe la mémoire pour toujours.
    if (this.vus.size > 500) for (const [k, v] of this.vus) if (v.every((t) => t <= depuis)) this.vus.delete(k);
    if (recents.length >= this.max) {
      this.vus.set(cle, recents);
      return false;
    }
    recents.push(maintenant);
    this.vus.set(cle, recents);
    return true;
  }

  /** Secondes à attendre avant que le prochain jeton se libère. */
  attente(cle: string, maintenant = Date.now()): number {
    const recents = this.vus.get(cle) ?? [];
    if (recents.length === 0) return 1;
    return Math.max(1, Math.ceil((recents[0] + this.fenetreMs - maintenant) / 1000));
  }
}

const PLAFOND_CLE = "plafondIaUsd";
/** Sans réglage, cinq dollars par mois : de quoi tout utiliser, pas de quoi se ruiner. */
export const PLAFOND_DEFAUT_CENTS = 500;

export interface EtatPlafond {
  /** Plafond du mois en centimes de dollar ; 0 signifie « pas de plafond ». */
  plafondCents: number;
  consommeCents: number;
  depasse: boolean;
}

export function plafondIa(db: DB, mois = currentMonth()): EtatPlafond {
  const reglage = (db.prepare("SELECT value FROM settings WHERE key = ?").get(PLAFOND_CLE) as { value: string } | undefined)?.value;
  const saisi = reglage === undefined ? NaN : Number(String(reglage).replace(",", "."));
  const plafondCents = Number.isFinite(saisi) && saisi >= 0 ? Math.round(saisi * 100) : PLAFOND_DEFAUT_CENTS;
  const micro = (db.prepare(
    "SELECT COALESCE(SUM(micro_usd), 0) AS c FROM ai_calls WHERE substr(created_at, 1, 7) = ?",
  ).get(mois) as { c: number }).c;
  const consommeCents = Math.round(micro / 10_000);
  return { plafondCents, consommeCents, depasse: plafondCents > 0 && consommeCents >= plafondCents };
}

/** Levée avant l'appel, pas après : une facture ne se rembourse pas. */
export class PlafondIaAtteint extends Error {
  constructor(etat: EtatPlafond) {
    const euros = (c: number) => (c / 100).toFixed(2).replace(".", ",");
    super(
      `Plafond IA du mois atteint : ${euros(etat.consommeCents)} $ dépensés sur ${euros(etat.plafondCents)} $. ` +
        "Les fonctions IA reprendront le mois prochain, ou tout de suite si vous relevez le plafond dans Réglages.",
    );
  }
}
