import type { DB } from "../db.js";
import type { CategorySuggestion } from "../../shared/types.js";

/**
 * Normalise un libellé bancaire : minuscules, sans accents, sans ponctuation.
 * Les nombres isolés disparaissent — ce sont des dates et des références de
 * transaction, qui changent à chaque passage du même commerçant. Les chiffres
 * collés à des lettres restent : « M6 », « B2B » ou « 5asec » font partie du nom.
 */
export function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/(cb|carte|paiement|prlv|prelevement|vir|virement|sepa|facture|achat)\b/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Longueur minimale d'un motif. Trois suffit : ce sont les frontières de mot,
 * et non la longueur, qui empêchent une règle de capturer ses voisines —
 * et « EDF » ou « SFR » sont de vraies enseignes.
 */
const MOTIF_MIN = 3;

/**
 * `aiguille` apparaît-elle dans `foin` en mots entiers ?
 * Un simple test de sous-chaîne faisait qu'une règle apprise sur « auto »
 * capturait « autoroute », « automobile » et « autogrill ».
 */
function contientMots(foin: string, aiguille: string): boolean {
  if (aiguille.length < MOTIF_MIN || foin.length < MOTIF_MIN) return false;
  return ` ${foin} `.includes(` ${aiguille} `);
}

/** Chaque correction de l'utilisateur crée ou renforce une règle libellé -> catégorie. */
export function learnRule(db: DB, label: string, categoryId: number, walletId: number | null): void {
  const pattern = normalizeLabel(label);
  if (pattern.length < MOTIF_MIN) return;
  db.prepare(
    `INSERT INTO category_rules (pattern, category_id, wallet_id) VALUES (?, ?, ?)
     ON CONFLICT(pattern) DO UPDATE SET category_id = excluded.category_id, wallet_id = excluded.wallet_id, hits = hits + 1, updated_at = datetime('now')`,
  ).run(pattern, categoryId, walletId);
}

/** Règle exacte d'abord, puis règle dont le motif est contenu dans le libellé (le plus long gagne). */
interface RuleRow { pattern: string; category_id: number; wallet_id: number | null }

/**
 * Jeu de règles chargé une fois, pour rapprocher beaucoup de libellés d'affilée.
 * Sans lui, un import de 30 000 lignes rechargeait les règles 30 000 fois :
 * près d'une demi-minute passée à relire la même table.
 */
export function loadRules(db: DB) {
  const rows = db.prepare("SELECT pattern, category_id, wallet_id FROM category_rules ORDER BY LENGTH(pattern) DESC").all() as unknown as RuleRow[];
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

/** Rapprochement d'un libellé isolé. Pour une série, préférer loadRules. */
export function matchRule(db: DB, label: string): CategorySuggestion | null {
  const norm = normalizeLabel(label);
  if (!norm) return null;
  const exact = db.prepare("SELECT category_id, wallet_id FROM category_rules WHERE pattern = ?").get(norm) as { category_id: number; wallet_id: number | null } | undefined;
  if (exact) return { categoryId: exact.category_id, walletId: exact.wallet_id, source: "rule" };
  return loadRules(db).match(label);
}

export function listRules(db: DB) {
  return db.prepare(`SELECT r.id, r.pattern, r.category_id AS categoryId, c.name AS categoryName, r.hits FROM category_rules r JOIN categories c ON c.id = r.category_id ORDER BY r.updated_at DESC`).all();
}

export function deleteRule(db: DB, id: number): boolean {
  return db.prepare("DELETE FROM category_rules WHERE id = ?").run(id).changes > 0;
}
