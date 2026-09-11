import type { DB } from "../db.js";
import type { Project, ProjectInput } from "../../shared/types.js";
import { monthsBetween, todayIso } from "../../shared/dates.js";
import { createTransaction } from "./transactions.js";

interface Row { id: number; name: string; target: number; due_date: string | null; wallet_id: number; done: number; wallet_name: string; saved: number }

const SELECT = `SELECT p.*, w.name AS wallet_name,
  COALESCE((SELECT SUM(CASE WHEN t.to_wallet_id = p.wallet_id THEN t.amount ELSE -t.amount END) FROM transactions t WHERE t.project_id = p.id AND t.type = 'transfer'), 0) AS saved
  FROM projects p JOIN wallets w ON w.id = p.wallet_id`;

function map(r: Row, today: string): Project {
  const remaining = Math.max(0, r.target - r.saved);
  let monthlyNeeded: number | null = null;
  if (r.due_date && remaining > 0) {
    const months = Math.max(1, monthsBetween(today, r.due_date) + 1);
    monthlyNeeded = Math.ceil(remaining / months);
  }
  return {
    id: r.id, name: r.name, target: r.target, dueDate: r.due_date, walletId: r.wallet_id, walletName: r.wallet_name,
    saved: r.saved, remaining, ratio: r.target > 0 ? Math.min(1, r.saved / r.target) : 0, monthlyNeeded, done: r.done === 1 || r.saved >= r.target,
  };
}

export function listProjects(db: DB, today = todayIso()): Project[] {
  return (db.prepare(`${SELECT} ORDER BY p.done, p.due_date IS NULL, p.due_date, p.id`).all() as unknown as Row[]).map((r) => map(r, today));
}

export function getProject(db: DB, id: number, today = todayIso()): Project | null {
  const r = db.prepare(`${SELECT} WHERE p.id = ?`).get(id) as unknown as Row | undefined;
  return r ? map(r, today) : null;
}

export function createProject(db: DB, input: ProjectInput): Project {
  const res = db.prepare("INSERT INTO projects (name, target, due_date, wallet_id) VALUES (?, ?, ?, ?)").run(input.name, input.target, input.dueDate, input.walletId);
  return getProject(db, Number(res.lastInsertRowid))!;
}

export function updateProject(db: DB, id: number, input: ProjectInput): Project | null {
  db.prepare("UPDATE projects SET name = ?, target = ?, due_date = ?, wallet_id = ? WHERE id = ?").run(input.name, input.target, input.dueDate, input.walletId, id);
  return getProject(db, id);
}

export function deleteProject(db: DB, id: number): boolean {
  return db.prepare("DELETE FROM projects WHERE id = ?").run(id).changes > 0;
}

/** Alimenter un projet = virement interne vers le portefeuille du projet, marqué project_id. */
export function contribute(db: DB, projectId: number, amount: number, fromWalletId: number, date = todayIso()): Project {
  const p = getProject(db, projectId);
  if (!p) throw new Error("Projet introuvable");
  if (fromWalletId === p.walletId) throw new Error("Choisir un portefeuille source différent de celui du projet");
  createTransaction(db, {
    type: "transfer", amount, date, walletId: fromWalletId, toWalletId: p.walletId, categoryId: null, projectId, label: `Projet : ${p.name}`, note: "",
  });
  return getProject(db, projectId)!;
}
