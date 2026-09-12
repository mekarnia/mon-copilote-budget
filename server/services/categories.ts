import type { DB } from "../db.js";
import type { Category, CategoryInput } from "../../shared/types.js";

interface Row { id: number; name: string; kind: Category["kind"]; parent_id: number | null; icon: string | null; sort: number; technical_key: string | null; avoidable: number }

const map = (r: Row): Category => ({ id: r.id, name: r.name, kind: r.kind, parentId: r.parent_id, icon: r.icon, sort: r.sort, technicalKey: r.technical_key, avoidable: r.avoidable === 1 });

export function setAvoidable(db: DB, id: number, avoidable: boolean): Category | null {
  db.prepare("UPDATE categories SET avoidable = ? WHERE id = ?").run(avoidable ? 1 : 0, id);
  return getCategory(db, id);
}

export function listCategories(db: DB): Category[] {
  return (db.prepare("SELECT * FROM categories ORDER BY sort, id").all() as unknown as Row[]).map(map);
}

export function getCategory(db: DB, id: number): Category | null {
  const r = db.prepare("SELECT * FROM categories WHERE id = ?").get(id) as unknown as Row | undefined;
  return r ? map(r) : null;
}

export function createCategory(db: DB, input: CategoryInput): Category {
  const kind = input.parentId ? getCategory(db, input.parentId)?.kind ?? input.kind : input.kind;
  const max = db.prepare("SELECT COALESCE(MAX(sort), 0) AS m FROM categories").get() as { m: number };
  const res = db.prepare("INSERT INTO categories (name, kind, parent_id, icon, sort) VALUES (?, ?, ?, ?, ?)").run(input.name, kind, input.parentId, input.icon, max.m + 1);
  return getCategory(db, Number(res.lastInsertRowid))!;
}

export function updateCategory(db: DB, id: number, input: CategoryInput): Category | null {
  const existing = getCategory(db, id);
  if (!existing || existing.technicalKey) return existing;
  db.prepare("UPDATE categories SET name = ?, icon = ?, parent_id = ? WHERE id = ?").run(input.name, input.icon, input.parentId, id);
  return getCategory(db, id);
}

/** Suppression : les opérations, budgets et récurrences sont réaffectés à `reassignTo`. */
export function deleteCategory(db: DB, id: number, reassignTo: number | null): boolean {
  const existing = getCategory(db, id);
  if (!existing || existing.technicalKey) return false;
  const ids = [id, ...listCategories(db).filter((c) => c.parentId === id).map((c) => c.id)];
  const placeholders = ids.map(() => "?").join(",");
  const used = db.prepare(`SELECT COUNT(*) AS n FROM transactions WHERE category_id IN (${placeholders})`).get(...ids) as { n: number };
  if (used.n > 0 && !reassignTo) throw new Error("Choisir une catégorie de réaffectation");
  if (reassignTo) {
    db.prepare(`UPDATE transactions SET category_id = ? WHERE category_id IN (${placeholders})`).run(reassignTo, ...ids);
    db.prepare(`UPDATE recurrences SET category_id = ? WHERE category_id IN (${placeholders})`).run(reassignTo, ...ids);
  }
  db.prepare(`DELETE FROM budgets WHERE category_id IN (${placeholders})`).run(...ids);
  db.prepare("DELETE FROM categories WHERE id = ?").run(id);
  return true;
}
