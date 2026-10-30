import type { CategorySuggestion } from "./types.js";
import { normalizeLabel } from "./libelle.js";

/**
 * Longueur minimale d'un motif. Trois suffit : ce sont les frontières de mot,
 * et non la longueur, qui empêchent une règle de capturer ses voisines —
 * et « EDF » ou « SFR » sont de vraies enseignes.
 */
export const MOTIF_MIN = 3;

/**
 * `aiguille` apparaît-elle dans `foin` en mots entiers ?
 * Un simple test de sous-chaîne faisait qu'une règle apprise sur « auto »
 * capturait « autoroute », « automobile » et « autogrill ».
 */
function contientMots(foin: string, aiguille: string): boolean {
  if (aiguille.length < MOTIF_MIN || foin.length < MOTIF_MIN) return false;
  return ` ${foin} `.includes(` ${aiguille} `);
}

/** Règle exacte d'abord, puis règle dont le motif est contenu dans le libellé (le plus long gagne). */
export interface RuleRow { pattern: string; category_id: number; wallet_id: number | null }

/**
 * Jeu de règles chargé une fois, pour rapprocher beaucoup de libellés d'affilée.
 * Sans lui, un import de 30 000 lignes rechargeait les règles 30 000 fois :
 * près d'une demi-minute passée à relire la même table.
 */
export function rapprocheur(regles: RuleRow[]) {
  const rows = [...regles].sort((x, y) => y.pattern.length - x.pattern.length);
  const exactes = new Map(rows.map((r) => [r.pattern, r]));
  return {
    match(label: string): CategorySuggestion | null {
      const norm = normalizeLabel(label);
      if (!norm) return null;
      const exact = exactes.get(norm);
      if (exact) return { categoryId: exact.category_id, walletId: exact.wallet_id, source: "rule" };
      for (const r of rows) {
        if (contientMots(norm, r.pattern) || contientMots(r.pattern, norm)) {
          return { categoryId: r.category_id, walletId: r.wallet_id, source: "rule" };
        }
      }
      return null;
    },
  };
}

