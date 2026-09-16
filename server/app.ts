import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { streamSSE } from "hono/streaming";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { getConnInfo } from "@hono/node-server/conninfo";
import fs from "node:fs";
import path from "node:path";
import type { z } from "zod";
import type { DB } from "./db.js";
import {
  adjustInput, budgetApplyInput, budgetCopyInput, budgetInput, bulkTransactionInput, categoryInput, chatInput, contributeInput, importCommitInput, parseTextInput, projectInput, recurrenceInput,
  transactionInput, walletInput, type CategorySuggestion, type ImportColumnMapping,
} from "../shared/types.js";
import { currentMonth, todayIso } from "../shared/dates.js";
import * as wallets from "./services/wallets.js";
import * as categories from "./services/categories.js";
import * as tx from "./services/transactions.js";
import * as rec from "./services/recurrences.js";
import * as budgets from "./services/budgets.js";
import * as projects from "./services/projects.js";
import { homeSummary } from "./services/home.js";
import { exportCsv, exportJson, importJson } from "./services/backup.js";
import { versionInfo } from "./services/version.js";
import { aiUsageSummary } from "./services/aiUsage.js";
import { Limiteur, plafondIa } from "./services/quotas.js";
import { adressePrivee, COOKIE, creerJeton, definirMotDePasse, DUREE_COOKIE, jetonValide, motDePasseConfigure, verifierMotDePasse } from "./services/session.js";
import { EXTENSION_IMAGE, typeImage } from "./services/securite.js";
import { AiNotConfigured, CLE_VALIDE, expliquerErreurIa, extractReceipt, hasKey, parseSpeech, PlafondIaAtteint, readKey, suggestCategory, testKey, writeKey } from "./services/ai.js";
import { deleteRule, listRules, matchRule } from "./services/rules.js";
import * as importer from "./services/importer.js";
import * as coach from "./services/coach.js";
import { suggestHabits } from "./services/habits.js";
import { stats } from "./services/stats.js";
import { periodStats, PERIOD_KEYS, type PeriodKey } from "./services/periods.js";
import { computeInsights } from "./services/insights.js";

export interface AppOptions {
  db: DB;
  uploadsDir: string;
  distDir?: string;
}

/**
 * Seules la machine elle-même et le réseau domestique peuvent appeler l'API.
 * Sans cela, une page web ouverte dans le navigateur pouvait lire toutes les données.
 */
function origineAutorisee(origine: string | undefined): boolean {
  if (!origine) return true; // même origine : le navigateur n'envoie pas d'en-tête Origin
  try {
    const h = new URL(origine).hostname;
    return (
      h === "localhost" ||
      h === "127.0.0.1" ||
      h === "::1" ||
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(h) ||
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(h)
    );
  } catch {
    return false;
  }
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function parse<S extends z.ZodTypeAny>(schema: S, body: unknown): z.output<S> {
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => `${i.path.join(".") || "champ"} : ${i.message}`).join(" ; "));
  return r.data;
}

const id = (s: string) => {
  const n = Number(s);
  if (!Number.isInteger(n)) throw new HttpError(400, "Identifiant invalide");
  return n;
};

/**
 * Un relais est-il placé devant nous ? Sur Fly, oui ; à la maison, non.
 *
 * La question n'est pas cosmétique : « x-forwarded-for » est un en-tête que
 * n'importe quel client écrit lui-même. Le croire sans relais devant soi, c'est
 * laisser le premier venu se déclarer « 127.0.0.1 » et franchir la porte.
 */
const DERRIERE_RELAIS = process.env.BUDGET_DERRIERE_RELAIS === "1" || !!process.env.FLY_APP_NAME;

/** L'adresse réelle de l'appelant. */
function adresseIp(c: { req: { header: (n: string) => string | undefined } }): string | undefined {
  if (DERRIERE_RELAIS) {
    // Le relais ajoute l'adresse du client à la fin : les valeurs précédentes
    // viennent du client et ne valent rien. C'est la dernière qui est la sienne.
    const chaine = (c.req.header("x-forwarded-for") ?? "").split(",").map((v) => v.trim()).filter(Boolean);
    if (chaine.length > 0) return chaine[chaine.length - 1];
  }
  try {
    return getConnInfo(c as unknown as Parameters<typeof getConnInfo>[0]).remote.address;
  } catch {
    return undefined; // hors serveur Node (les tests) : pas d'adresse, donc pas privée
  }
}

/**
 * L'appel vient-il du réseau de la maison ?
 *
 * Derrière un relais, la réponse est non par construction : « la maison » n'a
 * plus de sens quand tout arrive par internet, et se fier à un en-tête pour en
 * décider revient à laisser le visiteur se déclarer lui-même chez vous.
 */
function venuDeLaMaison(c: { req: { header: (n: string) => string | undefined } }): boolean {
  return !DERRIERE_RELAIS && adressePrivee(adresseIp(c));
}

/** Qui appelle, pour compter son débit : la même adresse que pour la porte. */
function appelant(c: { req: { header: (n: string) => string | undefined } }): string {
  return adresseIp(c) ?? "local";
}

export function createApp({ db, uploadsDir, distDir }: AppOptions) {
  const app = new Hono();
  // Les limiteurs appartiennent au serveur, pas au module : deux serveurs dans
  // le même processus (les tests) ne doivent pas se voler leurs jetons.
  const debitApi = new Limiteur(600, 60_000);
  const debitIa = new Limiteur(20, 60_000);

  app.use("/api/*", cors({ origin: (origine) => (origineAutorisee(origine) ? origine : "") }));
  app.use("*", async (c, next) => {
    await next();
    // Un fichier téléversé ne doit jamais être interprété d'après son contenu :
    // c'est ce qui transforme un envoi de photo en page exécutée par le navigateur.
    c.header("X-Content-Type-Options", "nosniff");
  });
  // ---- Porte d'entrée ----
  // Trois routes doivent rester ouvertes : celle qui dit s'il faut un mot de
  // passe, celle qui le vérifie, et la version (pour déboguer à distance).
  const OUVERTES = new Set(["/api/session", "/api/version"]);

  app.use("/api/*", async (c, next) => {
    const chemin = new URL(c.req.url).pathname;
    if (!OUVERTES.has(chemin)) {
      if (motDePasseConfigure()) {
        if (!jetonValide(getCookie(c, COOKIE))) return c.json({ error: "Connectez-vous pour continuer." }, 401);
      } else if (!venuDeLaMaison(c)) {
        // Sans mot de passe, l'application reste à la maison. Mise en ligne par
        // mégarde, elle se tait au lieu d'ouvrir des relevés bancaires.
        return c.json({ error: "Aucun mot de passe n'est configuré : l'application ne répond qu'au réseau local." }, 403);
      }
    }
    if (!debitApi.autorise(appelant(c))) {
      c.header("Retry-After", String(debitApi.attente(appelant(c))));
      return c.json({ error: "Trop de requêtes d'un coup. Réessayez dans quelques secondes." }, 429);
    }
    return next();
  });
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
    // Le détail part dans le journal, pas au client : un message de moteur SQL
    // renvoyé tel quel est une carte du système offerte à qui sonde.
    const ref = Math.random().toString(36).slice(2, 8);
    console.error(`[${ref}]`, err);
    return c.json({ error: `Erreur interne du serveur (référence ${ref}).` }, 500);
  });

  const api = new Hono();

  api.get("/session", (c) => c.json({
    configure: motDePasseConfigure(),
    connecte: jetonValide(getCookie(c, COOKIE)),
    local: venuDeLaMaison(c),
  }));
  api.post("/session", async (c) => {
    const body = (await c.req.json()) as { motDePasse?: string; nouveau?: string };
    // Premier démarrage depuis la maison : on choisit le mot de passe ici.
    if (!motDePasseConfigure()) {
      if (!venuDeLaMaison(c)) throw new HttpError(403, "Le mot de passe se choisit depuis le réseau de la maison, ou se fournit au serveur par BUDGET_MOT_DE_PASSE.");
      try {
        definirMotDePasse(String(body.nouveau ?? ""));
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
    } else if (!verifierMotDePasse(String(body.motDePasse ?? ""))) {
      // Une seconde d'attente : un mot de passe ne se devine pas à la vitesse du réseau.
      await new Promise((r) => setTimeout(r, 1000));
      throw new HttpError(401, "Mot de passe incorrect.");
    }
    setCookie(c, COOKIE, creerJeton(), {
      httpOnly: true, sameSite: "Lax", path: "/", maxAge: DUREE_COOKIE,
      secure: new URL(c.req.url).protocol === "https:",
    });
    return c.json({ ok: true });
  });
  /** Choisir ou changer le mot de passe depuis l'application elle-même. */
  api.put("/session", async (c) => {
    const body = (await c.req.json()) as { actuel?: string; nouveau?: string };
    if (motDePasseConfigure()) {
      if (!verifierMotDePasse(String(body.actuel ?? ""))) {
        await new Promise((r) => setTimeout(r, 1000));
        throw new HttpError(401, "Mot de passe actuel incorrect.");
      }
    } else if (!venuDeLaMaison(c)) {
      throw new HttpError(403, "Le mot de passe se choisit depuis le réseau de la maison.");
    }
    try {
      definirMotDePasse(String(body.nouveau ?? ""));
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    // Un nouveau mot de passe déconnecte tous les appareils : on reconnecte
    // celui-ci, sinon on se met soi-même dehors en le changeant.
    setCookie(c, COOKIE, creerJeton(), {
      httpOnly: true, sameSite: "Lax", path: "/", maxAge: DUREE_COOKIE,
      secure: new URL(c.req.url).protocol === "https:",
    });
    return c.json({ ok: true });
  });
  api.delete("/session", (c) => {
    deleteCookie(c, COOKIE, { path: "/" });
    return c.json({ ok: true });
  });


  // Portefeuilles
  api.get("/wallets", (c) => c.json(wallets.listWallets(db, c.req.query("all") === "1")));
  api.post("/wallets", async (c) => c.json(wallets.createWallet(db, parse(walletInput, await c.req.json())), 201));
  api.put("/wallets/:id", async (c) => {
    const w = wallets.updateWallet(db, id(c.req.param("id")), parse(walletInput, await c.req.json()));
    return w ? c.json(w) : c.json({ error: "Introuvable" }, 404);
  });
  api.delete("/wallets/:id", (c) => {
    const r = wallets.removeWallet(db, id(c.req.param("id")));
    return r === "not_found" ? c.json({ error: "Introuvable" }, 404) : c.json({ result: r });
  });
  api.post("/wallets/:id/adjust", async (c) => {
    const body = parse(adjustInput, await c.req.json());
    return c.json(wallets.adjustWallet(db, id(c.req.param("id")), body.realBalance, body.date ?? todayIso()));
  });

  // Catégories
  api.get("/categories", (c) => c.json(categories.listCategories(db)));
  api.get("/categories/:id/context", (c) => {
    const type = c.req.query("type") === "income" ? "income" : "expense";
    const ctx = tx.categoryContext(db, id(c.req.param("id")), c.req.query("month") || currentMonth(), type);
    return c.json(ctx ?? { month: null, currentId: null, parent: null, subs: [] });
  });
  api.post("/categories", async (c) => c.json(categories.createCategory(db, parse(categoryInput, await c.req.json())), 201));
  api.put("/categories/:id", async (c) => {
    const r = categories.updateCategory(db, id(c.req.param("id")), parse(categoryInput, await c.req.json()));
    return r ? c.json(r) : c.json({ error: "Introuvable" }, 404);
  });
  api.delete("/categories/:id", (c) => {
    const reassign = c.req.query("reassignTo");
    try {
      const ok = categories.deleteCategory(db, id(c.req.param("id")), reassign ? id(reassign) : null);
      return ok ? c.json({ ok: true }) : c.json({ error: "Catégorie introuvable ou protégée" }, 404);
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
  });

  // Opérations
  api.get("/transactions", (c) => {
    const walletId = c.req.query("walletId");
    const status = c.req.query("status");
    const categoryId = c.req.query("categoryId");
    const type = c.req.query("type");
    return c.json(tx.listTransactions(db, {
      categoryId: categoryId ? id(categoryId) : undefined,
      from: c.req.query("from") || undefined,
      to: c.req.query("to") || undefined,
      type: type === "expense" || type === "income" || type === "transfer" ? type : undefined,
      status: status === "to_verify" || status === "confirmed" ? status : undefined,
      month: c.req.query("month") || undefined,
      q: c.req.query("q") || undefined,
      walletId: walletId ? id(walletId) : undefined,
      limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
    }));
  });
  api.get("/transactions/labels", (c) => c.json(tx.suggestLabels(db, c.req.query("q") ?? "")));
  api.get("/transactions/habits", (c) => {
    const type = c.req.query("type");
    if (type !== "expense" && type !== "income") return c.json([]);
    const categoryId = c.req.query("categoryId");
    const amount = c.req.query("amount");
    return c.json(suggestHabits(db, { type, categoryId: categoryId ? id(categoryId) : null, amount: amount ? Number(amount) : null }));
  });
  api.get("/transactions/to-verify-count", (c) => c.json({ count: tx.countToVerify(db) }));
  /** Valider, reclasser ou supprimer d'un coup les lignes cochées après un import. */
  api.post("/transactions/bulk", async (c) => {
    const { ids, action, categoryId } = parse(bulkTransactionInput, await c.req.json());
    if (action === "recategorize") {
      if (categoryId === null) throw new HttpError(400, "Choisissez une catégorie");
      return c.json({ done: tx.recategorizeMany(db, ids, categoryId) });
    }
    if (action === "delete") {
      for (const i of ids) {
        const t = tx.getTransaction(db, i);
        if (t?.photoPath) fs.rmSync(path.join(uploadsDir, path.basename(t.photoPath)), { force: true });
      }
      return c.json({ done: tx.deleteMany(db, ids) });
    }
    return c.json({ done: tx.confirmMany(db, ids) });
  });
  api.post("/transactions/:id/confirm", (c) => {
    const t = tx.confirmTransaction(db, id(c.req.param("id")));
    return t ? c.json(t) : c.json({ error: "Introuvable" }, 404);
  });
  api.get("/transactions/:id/context", (c) => {
    const ctx = tx.transactionContext(db, id(c.req.param("id")));
    return ctx ? c.json(ctx) : c.json({ month: null, sub: null, parent: null });
  });
  api.get("/transactions/:id", (c) => {
    const t = tx.getTransaction(db, id(c.req.param("id")));
    return t ? c.json(t) : c.json({ error: "Introuvable" }, 404);
  });
  api.post("/transactions", async (c) => c.json(tx.createTransaction(db, parse(transactionInput, await c.req.json())), 201));
  api.put("/transactions/:id", async (c) => {
    const t = tx.updateTransaction(db, id(c.req.param("id")), parse(transactionInput, await c.req.json()));
    return t ? c.json(t) : c.json({ error: "Introuvable" }, 404);
  });
  api.delete("/transactions/:id", (c) => {
    const t = tx.getTransaction(db, id(c.req.param("id")));
    if (!t) return c.json({ error: "Introuvable" }, 404);
    if (t.photoPath) fs.rmSync(path.join(uploadsDir, path.basename(t.photoPath)), { force: true });
    tx.deleteTransaction(db, t.id);
    return c.json({ ok: true });
  });
  api.post("/transactions/:id/photo", async (c) => {
    const txId = id(c.req.param("id"));
    const t = tx.getTransaction(db, txId);
    if (!t) return c.json({ error: "Introuvable" }, 404);
    const form = await c.req.formData();
    const contenu = await photoRecue(form.get("photo"));
    const name = `tx-${txId}-${Date.now()}.${EXTENSION_IMAGE[contenu.type]}`;
    fs.mkdirSync(uploadsDir, { recursive: true });
    fs.writeFileSync(path.join(uploadsDir, name), contenu.buf);
    if (t.photoPath) fs.rmSync(path.join(uploadsDir, path.basename(t.photoPath)), { force: true });
    return c.json(tx.setPhoto(db, txId, `/uploads/${name}`));
  });
  api.delete("/transactions/:id/photo", (c) => {
    const t = tx.getTransaction(db, id(c.req.param("id")));
    if (!t) return c.json({ error: "Introuvable" }, 404);
    if (t.photoPath) fs.rmSync(path.join(uploadsDir, path.basename(t.photoPath)), { force: true });
    return c.json(tx.setPhoto(db, t.id, null));
  });

  // Récurrences
  api.get("/recurrences", (c) => c.json(rec.listRecurrences(db)));
  api.get("/recurrences/upcoming", (c) => {
    const from = c.req.query("from") ?? todayIso();
    const to = c.req.query("to") ?? from;
    return c.json(rec.upcomingBills(db, from, to));
  });
  api.post("/recurrences", async (c) => c.json(rec.createRecurrence(db, parse(recurrenceInput, await c.req.json())), 201));
  api.put("/recurrences/:id", async (c) => {
    const r = rec.updateRecurrence(db, id(c.req.param("id")), parse(recurrenceInput, await c.req.json()));
    return r ? c.json(r) : c.json({ error: "Introuvable" }, 404);
  });
  api.delete("/recurrences/:id", (c) => (rec.deleteRecurrence(db, id(c.req.param("id"))) ? c.json({ ok: true }) : c.json({ error: "Introuvable" }, 404)));
  api.post("/recurrences/run", (c) => c.json({ created: rec.runDueRecurrences(db) }));

  // Budgets (propres à chaque mois)
  api.get("/budgets", (c) => {
    const month = c.req.query("month") || currentMonth();
    return c.json({ lines: budgets.budgetLines(db, month), summary: budgets.budgetSummary(db, month) });
  });
  api.put("/budgets", async (c) => {
    const b = parse(budgetInput, await c.req.json());
    budgets.setBudget(db, b.categoryId, b.month, b.amount);
    return c.json({ lines: budgets.budgetLines(db, b.month), summary: budgets.budgetSummary(db, b.month) });
  });
  api.post("/budgets/copy", async (c) => {
    const b = parse(budgetCopyInput, await c.req.json());
    return c.json({ copied: budgets.copyBudgets(db, b.from, b.to) });
  });
  api.get("/budgets/suggest", async (c) => c.json(await coach.suggestedBudgets(db, c.req.query("month") || currentMonth())));
  api.post("/budgets/apply", async (c) => {
    const b = parse(budgetApplyInput, await c.req.json());
    budgets.applyBudgets(db, b.month, b.items);
    return c.json({ lines: budgets.budgetLines(db, b.month), summary: budgets.budgetSummary(db, b.month) });
  });

  // Projets
  api.get("/projects", (c) => c.json(projects.listProjects(db)));
  api.post("/projects", async (c) => c.json(projects.createProject(db, parse(projectInput, await c.req.json())), 201));
  api.put("/projects/:id", async (c) => {
    const p = projects.updateProject(db, id(c.req.param("id")), parse(projectInput, await c.req.json()));
    return p ? c.json(p) : c.json({ error: "Introuvable" }, 404);
  });
  api.delete("/projects/:id", (c) => (projects.deleteProject(db, id(c.req.param("id"))) ? c.json({ ok: true }) : c.json({ error: "Introuvable" }, 404)));
  api.post("/projects/:id/contribute", async (c) => {
    const b = parse(contributeInput, await c.req.json());
    try {
      return c.json(projects.contribute(db, id(c.req.param("id")), b.amount, b.fromWalletId, b.date ?? todayIso()));
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
  });

  // Suivi
  api.get("/stats", (c) => c.json(stats(db, c.req.query("month") || currentMonth())));
  const periodOf = (v: string | undefined): PeriodKey => (PERIOD_KEYS.includes(v as PeriodKey) ? (v as PeriodKey) : "1m");
  api.get("/stats/period", (c) => {
    const type = c.req.query("type") === "income" ? "income" : "expense";
    return c.json(periodStats(db, type, periodOf(c.req.query("period"))));
  });
  api.get("/stats/avoidable", (c) => c.json(coach.avoidableStats(db, periodOf(c.req.query("period")))));
  api.get("/stats/avoidable/goal", async (c) => c.json({ goal: await coach.avoidableAiGoal(db, periodOf(c.req.query("period"))) }));
  api.put("/categories/:id/avoidable", async (c) => {
    const body = (await c.req.json()) as { avoidable?: boolean };
    const r = categories.setAvoidable(db, id(c.req.param("id")), body.avoidable === true);
    return r ? c.json(r) : c.json({ error: "Introuvable" }, 404);
  });

  // Accueil
  api.get("/home", (c) => {
    rec.runDueRecurrences(db);
    return c.json(homeSummary(db, c.req.query("month") || currentMonth()));
  });

  // Sauvegarde
  api.get("/backup.json", (c) => {
    c.header("Content-Disposition", `attachment; filename="budget-${todayIso()}.json"`);
    return c.json(exportJson(db));
  });
  api.post("/backup.json", async (c) => {
    const data = (await c.req.json()) as Record<string, unknown[]>;
    if (!Array.isArray(data.transactions) || !Array.isArray(data.wallets)) throw new HttpError(400, "Fichier de sauvegarde invalide");
    importJson(db, data);
    return c.json({ ok: true });
  });
  api.get("/export.csv", (c) => {
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="operations-${todayIso()}.csv"`);
    return c.body(exportCsv(db));
  });

  // Réglages (clé IA pour le MVC 2, stockée côté serveur uniquement)
  api.get("/settings", (c) => {
    const rows = db.prepare("SELECT key, value FROM settings").all() as unknown as { key: string; value: string }[];
    const out: Record<string, string> = {};
    for (const r of rows) if (r.key !== "aiKey") out[r.key] = r.value;
    const cle = readKey();
    out.aiKey = cle ? "••••" + cle.slice(-4) : "";
    return c.json(out);
  });
  api.put("/settings", async (c) => {
    const body = (await c.req.json()) as Record<string, string>;
    const up = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    for (const [k, v] of Object.entries(body)) {
      if (typeof v !== "string" || k.length >= 40) continue;
      if (k === "aiKey") {
        const key = v.trim();
        if (key && !CLE_VALIDE.test(key)) {
          throw new HttpError(400, "Ce n'est pas une clé Anthropic. Elle commence par sk-ant- et ne contient que des lettres, chiffres et tirets. Copiez-la depuis console.anthropic.com puis API Keys.");
        }
        writeKey(key);
        continue;
      }
      up.run(k, v);
    }
    return c.json({ ok: true });
  });

  // ---- MVC 2 : IA, catégorisation, import ----
  const aiError = (e: unknown) => {
    if (e instanceof AiNotConfigured || e instanceof PlafondIaAtteint) throw new HttpError(400, e.message);
    throw new HttpError(502, `L'IA n'a pas pu répondre : ${expliquerErreurIa(e)}. Testez la clé dans Réglages pour savoir quel modèle est en cause.`);
  };

  /** Quelle version tourne réellement : indispensable pour déboguer à distance. */
  api.get("/version", (c) => c.json(versionInfo(path.resolve(import.meta.dirname, ".."))));

  /** Ce que l'IA a réellement coûté ce mois-ci, mesuré et non estimé, et ce qu'il reste avant le plafond. */
  api.get("/ai/usage", (c) => {
    const mois = c.req.query("month") || currentMonth();
    return c.json({ ...aiUsageSummary(db, mois), ...plafondIa(db, mois) });
  });

  // Un appel IA coûte de l'argent : son débit se compte à part, bien plus serré
  // que le reste de l'API, et avant même d'atteindre le modèle.
  for (const route of ["/ai/receipt", "/ai/parse", "/coach/chat", "/coach/chat/stream", "/import/commit", "/categorize"]) {
    api.use(route, async (c, next) => {
      if (c.req.method === "GET" && route !== "/categorize") return next();
      if (!debitIa.autorise(appelant(c))) {
        c.header("Retry-After", String(debitIa.attente(appelant(c))));
        return c.json({ error: "Trop de demandes à l'IA en une minute. Laissez passer un instant." }, 429);
      }
      return next();
    });
  }

  api.get("/ai/test", async (c) => {
    try {
      if (!hasKey()) throw new AiNotConfigured();
      return c.json({ ok: true, ...(await testKey(db)) });
    } catch (e) {
      return aiError(e);
    }
  });

  api.post("/ai/receipt", async (c) => {
    const contenu = await photoRecue((await c.req.formData()).get("photo"));
    try {
      return c.json(await extractReceipt(db, contenu.buf, contenu.type));
    } catch (e) {
      return aiError(e);
    }
  });

  api.post("/ai/parse", async (c) => {
    const { text } = parse(parseTextInput, await c.req.json());
    try {
      return c.json(await parseSpeech(db, text));
    } catch (e) {
      return aiError(e);
    }
  });

  /** Règle apprise d'abord ; IA seulement si aucune règle et si une clé est configurée. */
  const categorize = async (label: string): Promise<CategorySuggestion> => {
    const rule = matchRule(db, label);
    if (rule) return rule;
    try {
      const categoryId = await suggestCategory(db, label);
      return { categoryId, walletId: null, source: categoryId ? "ai" : "none" };
    } catch {
      return { categoryId: null, walletId: null, source: "none" };
    }
  };
  api.get("/categorize", async (c) => {
    const label = (c.req.query("label") ?? "").trim();
    if (label.length < 2) return c.json({ categoryId: null, walletId: null, source: "none" } satisfies CategorySuggestion);
    return c.json(await categorize(label));
  });
  api.get("/rules", (c) => c.json(listRules(db)));
  api.delete("/rules/:id", (c) => (deleteRule(db, id(c.req.param("id"))) ? c.json({ ok: true }) : c.json({ error: "Introuvable" }, 404)));

  api.post("/import/preview", async (c) => {
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Fichier manquant");
    if (file.size > 5 * 1024 * 1024) throw new HttpError(400, "Fichier trop lourd (5 Mo max)");
    const csv = decodeCsv(Buffer.from(await file.arrayBuffer()));
    const walletId = id(String(form.get("walletId") ?? ""));
    const bank = String(form.get("bank") ?? "").trim() || null;
    const mappingRaw = form.get("mapping");
    const override = typeof mappingRaw === "string" && mappingRaw ? (JSON.parse(mappingRaw) as ImportColumnMapping) : undefined;
    try {
      return c.json({ ...importer.preview(db, csv, walletId, bank, override), csv, banks: importer.knownBanks(db) });
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
  });
  api.post("/import/commit", async (c) => {
    const input = parse(importCommitInput, await c.req.json());
    const batch = await importer.commit(db, input, async (label) => (await categorize(label)).categoryId);
    return c.json(batch, 201);
  });
  api.get("/imports", (c) => c.json(importer.listImports(db)));
  api.delete("/imports/:id", (c) => {
    if (!importer.getImport(db, id(c.req.param("id")))) return c.json({ error: "Introuvable" }, 404);
    return c.json({ deleted: importer.cancelImport(db, id(c.req.param("id"))) });
  });

  // ---- MVC 3 : coach ----
  api.get("/coach/weekly", async (c) => c.json(await coach.weeklyAdvice(db, { force: c.req.query("refresh") === "1" })));
  api.get("/coach/insights", (c) => c.json(computeInsights(db)));
  api.get("/coach/chat", (c) => c.json(coach.listMessages(db)));
  api.delete("/coach/chat", (c) => { coach.clearMessages(db); return c.json({ ok: true }); });
  /** Version simple, sans flux : gardée pour les tests et pour tout client qui ne lit pas le SSE. */
  api.post("/coach/chat", async (c) => {
    const { message } = parse(chatInput, await c.req.json());
    try {
      return c.json(await coach.chat(db, message), 201);
    } catch (e) {
      return aiError(e);
    }
  });
  /**
   * La même réponse, mot à mot pendant qu'elle s'écrit. L'erreur voyage dans le
   * flux et non dans le code HTTP : à la première ligne envoyée, il est déjà parti.
   */
  api.post("/coach/chat/stream", async (c) => {
    const { message } = parse(chatInput, await c.req.json());
    return streamSSE(c, async (flux) => {
      try {
        const reponse = await coach.chat(db, message, {
          onDelta: (morceau) => void flux.writeSSE({ event: "morceau", data: JSON.stringify(morceau) }),
        });
        await flux.writeSSE({ event: "fin", data: JSON.stringify(reponse) });
      } catch (e) {
        const message = e instanceof AiNotConfigured || e instanceof PlafondIaAtteint
          ? (e as Error).message
          : `L'IA n'a pas pu répondre : ${expliquerErreurIa(e)}.`;
        await flux.writeSSE({ event: "erreur", data: JSON.stringify(message) });
      }
    });
  });

  app.route("/api", api);
  app.notFound((c) => (c.req.path.startsWith("/api/") ? c.json({ error: "Route inconnue" }, 404) : c.text("Not found", 404)));

  // Une photo de ticket est une donnée personnelle : elle passe la même porte.
  app.use("/uploads/*", async (c, next) => {
    if (motDePasseConfigure() && !jetonValide(getCookie(c, COOKIE))) return c.text("Connectez-vous pour continuer.", 401);
    if (!motDePasseConfigure() && !venuDeLaMaison(c)) return c.text("Accès refusé.", 403);
    return next();
  });
  app.use("/uploads/*", serveStatic({ root: path.relative(process.cwd(), path.dirname(uploadsDir)) || "." }));
  if (distDir && fs.existsSync(distDir)) {
    const rel = path.relative(process.cwd(), distDir) || ".";
    app.use("/*", serveStatic({ root: rel }));
    app.get("*", (c) => c.html(fs.readFileSync(path.join(distDir, "index.html"), "utf8")));
  }
  return app;
}

/**
 * Une photo reçue, vérifiée. Le type annoncé par le navigateur est déclaratif :
 * seul le contenu dit ce qu'est vraiment le fichier.
 */
async function photoRecue(champ: unknown): Promise<{ buf: Buffer; type: "image/jpeg" | "image/png" | "image/webp" }> {
  if (!(champ instanceof File)) throw new HttpError(400, "Photo manquante");
  if (champ.size > 10 * 1024 * 1024) throw new HttpError(400, "Photo trop lourde (10 Mo max)");
  const buf = Buffer.from(await champ.arrayBuffer());
  const type = typeImage(buf);
  if (!type) throw new HttpError(400, "Ce fichier n'est pas une image JPEG, PNG ou WebP.");
  return { buf, type };
}

/** Les exports bancaires sont souvent en Windows-1252 : on tente UTF-8 et on bascule si des caractères sont cassés. */
function decodeCsv(buf: Buffer): string {
  const utf8 = buf.toString("utf8");
  if (!utf8.includes("\uFFFD")) return utf8;
  return new TextDecoder("windows-1252").decode(buf);
}
