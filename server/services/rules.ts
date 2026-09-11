import type { DB } from "../db.js";
import type { CategorySuggestion } from "../../shared/types.js";

/** Normalise un libellé bancaire : minuscules, sans accents, sans chiffres ni ponctuation, espaces réduits. */
export function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/(cb|carte|paiement|prlv|prelevement|vir|virement|sepa|facture|achat)\b/g, " ")
    .replace(/[0-9]+/g, " ")
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Chaque correction de l'utilisateur crée ou renforce une règle libellé -> catégorie. */
export function learnRule(db: DB, label: string, categoryId: number, walletId: number | null): void {
  const pattern = normalizeLabel(label);
  if (pattern.length < 3) return;
  db.prepare(
    `INSERT INTO category_rules (pattern, category_id, wallet_id) VALUES (?, ?, ?)
     ON CONFLICT(pattern) DO UPDATE SET category_id = excluded.category_id, wallet_id = excluded.wallet_id, hits = hits + 1, updated_at = datetime('now')`,
  ).run(pattern, categoryId, walletId);
}

/** Règle exacte d'abord, puis règle dont le motif est contenu dans le libellé (le plus long gagne). */
export function matchRule(db: DB, label: string): CategorySuggestion | null {
  const norm = normalizeLabel(label);
  if (!norm) return null;
  const exact = db.prepare("SELECT category_id, wallet_id FROM category_rules WHERE pattern = ?").get(norm) as { category_id: number; wallet_id: number | null } | undefined;
  if (exact) return { categoryId: exact.category_id, walletId: exact.wallet_id, source: "rule" };
  const rows = db.prepare("SELECT pattern, category_id, wallet_id FROM category_rules ORDER BY LENGTH(pattern) DESC").all() as unknown as { pattern: string; category_id: number; wallet_id: number | null }[];
  for (const r of rows) {
    if (r.pattern.length >= 3 && (norm.includes(r.pattern) || r.pattern.includes(norm))) {
      return { categoryId: r.category_id, walletId: r.wallet_id, source: "rule" };
    }
  }
  return null;
}

export function listRules(db: DB) {
  return db.prepare(`SELECT r.id, r.pattern, r.category_id AS categoryId, c.name AS categoryName, r.hits FROM category_rules r JOIN categories c ON c.id = r.category_id ORDER BY r.updated_at DESC`).all();
}

export function deleteRule(db: DB, id: number): boolean {
  return db.prepare("DELETE FROM category_rules WHERE id = ?").run(id).changes > 0;
}
