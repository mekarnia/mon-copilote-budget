import type { DB } from "../db.js";
import type { CategorySuggestion } from "../../shared/types.js";

export { normalizeLabel } from "../../shared/libelle.js";
import { normalizeLabel } from "../../shared/libelle.js";
import { MOTIF_MIN, rapprocheur, type RuleRow } from "../../shared/regles.js";

/** Chaque correction de l'utilisateur crée ou renforce une règle libellé -> catégorie. */
export function learnRule(db: DB, label: string, categoryId: number, walletId: number | null): void {
  const pattern = normalizeLabel(label);
  if (pattern.length < MOTIF_MIN) return;
  db.prepare(
    `INSERT INTO category_rules (pattern, category_id, wallet_id) VALUES (?, ?, ?)
     ON CONFLICT(pattern) DO UPDATE SET category_id = excluded.category_id, wallet_id = excluded.wallet_id, hits = hits + 1, updated_at = datetime('now')`,
  ).run(pattern, categoryId, walletId);
}

/** Jeu de règles chargé une fois, pour rapprocher beaucoup de libellés d'affilée. */
export function loadRules(db: DB) {
  return rapprocheur(db.prepare("SELECT pattern, category_id, wallet_id FROM category_rules").all() as unknown as RuleRow[]);
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
