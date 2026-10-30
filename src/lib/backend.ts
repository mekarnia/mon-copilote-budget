/**
 * Les mêmes adresses /api/… qu'avant, servies par Supabase depuis le navigateur.
 *
 * Les écrans appellent toujours api.get("/api/home?month=…") : ils ne savent pas
 * que le serveur local a disparu. Chaque route lit ou écrit dans Supabase, où la
 * sécurité par ligne limite le compte connecté aux données de son foyer. Les
 * calculs lourds (soldes, accueil, budgets) sont des fonctions SQL ; ce fichier
 * ne fait que les appeler et remettre les noms de champs au format des écrans.
 */
import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import {
  budgetApplyInput, budgetCopyInput, budgetInput, bulkTransactionInput, categoryInput, contributeInput, importCommitInput, projectInput, recurrenceInput,
  transactionInput, walletInput,
  type BudgetLine, type Category, type CategorySuggestion, type HabitSuggestion, type HomeSummary, type ImportBatch, type ImportColumnMapping,
  type ImportPreviewRow, type LabelSuggestion, type Project, type TxType,
  type Recurrence, type Transaction, type Wallet,
} from "@shared/types";
import { addDays, monthOf, nextOccurrence, shiftMonth, todayIso } from "@shared/dates";
import { classerHabitudes, type LigneHabitude } from "@shared/habitudes";
import { applyMapping, detectMapping, parseCsv } from "@shared/releve";
import { matchBankCategory } from "@shared/banque";
import { rapprocheur, type RuleRow } from "@shared/regles";
import { normalizeLabel } from "@shared/libelle";
import { EXTENSION_IMAGE, typeImage } from "@shared/image";
import {
  bornesLecture, calculerEvitables, calculerPeriode, calculerStats, periodRange, PERIOD_KEYS,
  type CategorieSuivi, type LigneJour, type PeriodKey,
} from "@shared/suivi";
import type { z } from "zod";

import { ApiError } from "./erreur";

// ---------- Outils ----------

/** Une erreur Supabase devient un message lisible, comme le serveur local en renvoyait. */
function echec(e: PostgrestError | null): never | void {
  if (!e) return;
  if (e.code === "PGRST116") throw new ApiError(404, "Introuvable");
  if (e.code === "23503") throw new ApiError(400, "Élément lié introuvable ou appartenant à un autre foyer.");
  if (e.code === "42501") throw new ApiError(403, "Accès refusé.");
  throw new ApiError(400, e.message);
}

function valider<S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
  const r = schema.safeParse(body);
  if (!r.success) throw new ApiError(400, r.error.issues.map((i) => `${i.path.join(".") || "champ"} : ${i.message}`).join(" ; "));
  return r.data;
}

const entier = (v: string | undefined | null) => (v && /^\d+$/.test(v) ? Number(v) : undefined);

/** PostgREST découpe ses filtres « or » sur les virgules et les parenthèses : on les retire de la recherche. */
const pourRecherche = (q: string) => q.replace(/[,()*%\\]/g, " ").trim();

const pasEncore = (etape: number, quoi: string) => () => {
  throw new ApiError(501, `${quoi} arrive à l'étape ${etape} de la migration vers Supabase.`);
};

// ---------- Lignes Supabase -> objets des écrans ----------

interface LigneTransaction {
  id: number; type: Transaction["type"]; amount: number; date: string; time: string | null; wallet_id: number; to_wallet_id: number | null;
  category_id: number | null; project_id: number | null; recurrence_id: number | null; import_id: number | null; label: string; note: string;
  photo_path: string | null; status: Transaction["status"]; payment_method: Transaction["paymentMethod"];
  category_name: string | null; technical_key: string | null; wallet_name: string; to_wallet_name: string | null; created_by_prenom: string | null;
}

const versTransaction = (r: LigneTransaction): Transaction & { createdBy: string | null } => ({
  id: r.id, type: r.type, amount: r.amount, date: r.date, time: r.time, walletId: r.wallet_id, toWalletId: r.to_wallet_id,
  categoryId: r.category_id, projectId: r.project_id, recurrenceId: r.recurrence_id, importId: r.import_id, label: r.label, note: r.note,
  photoPath: r.photo_path, status: r.status, paymentMethod: r.payment_method ?? null, technical: r.technical_key !== null,
  categoryName: r.category_name, walletName: r.wallet_name, toWalletName: r.to_wallet_name, createdBy: r.created_by_prenom,
});

interface LigneCategorie { id: number; name: string; kind: Category["kind"]; parent_id: number | null; icon: string | null; sort: number; technical_key: string | null; avoidable: boolean }
const versCategorie = (r: LigneCategorie): Category => ({
  id: r.id, name: r.name, kind: r.kind, parentId: r.parent_id, icon: r.icon, sort: r.sort, technicalKey: r.technical_key, avoidable: r.avoidable,
});

interface LigneSolde { id: number; name: string; type: Wallet["type"]; initial_balance: number; archived: boolean; balance: number }
const versPortefeuille = (r: LigneSolde): Wallet => ({ id: r.id, name: r.name, type: r.type, initialBalance: r.initial_balance, archived: r.archived, balance: r.balance });

interface LigneProjet { id: number; name: string; target: number; due_date: string | null; wallet_id: number; wallet_name: string; saved: number; remaining: number; ratio: number; monthly_needed: number | null; done: boolean }
const versProjet = (r: LigneProjet): Project => ({
  id: r.id, name: r.name, target: r.target, dueDate: r.due_date, walletId: r.wallet_id, walletName: r.wallet_name, saved: r.saved,
  remaining: r.remaining, ratio: r.ratio, monthlyNeeded: r.monthly_needed, done: r.done,
});

// ---------- Lectures partagées ----------

/**
 * Supabase renvoie au plus 1 000 lignes par requête : un relevé importé ou une
 * année de suivi en compte davantage. On lit donc par tranches, dans un ordre
 * stable, jusqu'à la dernière.
 */
async function toutesLesLignes<T>(requete: (debut: number, fin: number) => PromiseLike<{ data: unknown; error: PostgrestError | null }>): Promise<T[]> {
  const TRANCHE = 1000;
  const out: T[] = [];
  for (let debut = 0; ; debut += TRANCHE) {
    const { data, error } = await requete(debut, debut + TRANCHE - 1);
    echec(error);
    const lignes = (data ?? []) as T[];
    out.push(...lignes);
    if (lignes.length < TRANCHE) return out;
  }
}

/** Découpe une liste d'identifiants : une adresse trop longue serait refusée. */
function paquets<T>(liste: T[], taille = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < liste.length; i += taille) out.push(liste.slice(i, i + taille));
  return out;
}

let foyerEnCache: { user: string; foyer: string } | null = null;
/** Le dossier des photos du foyer porte son identifiant. */
async function monFoyer(): Promise<string> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new ApiError(401, "Connectez-vous pour continuer.");
  if (foyerEnCache?.user === u.user.id) return foyerEnCache.foyer;
  const { data, error } = await supabase.from("membres").select("foyer_id").eq("user_id", u.user.id).single();
  echec(error);
  foyerEnCache = { user: u.user.id, foyer: (data as { foyer_id: string }).foyer_id };
  return foyerEnCache.foyer;
}

const BUCKET = "tickets";

async function supprimerPhotos(chemins: (string | null)[]) {
  const liste = chemins.filter((c): c is string => !!c && !c.startsWith("/"));
  if (liste.length) await supabase.storage.from(BUCKET).remove(liste);
}

async function transaction(id: number) {
  const { data, error } = await supabase.from("transactions_detail").select("*").eq("id", id).single();
  echec(error);
  const t = versTransaction(data as LigneTransaction);
  // La photo est privée : on l'affiche par un lien signé, valable une heure.
  if (t.photoPath && !t.photoPath.startsWith("/")) {
    const { data: lien } = await supabase.storage.from(BUCKET).createSignedUrl(t.photoPath, 3600);
    t.photoPath = lien?.signedUrl ?? null;
  }
  return t;
}

async function categories(): Promise<Category[]> {
  const { data, error } = await supabase.from("categories").select("*").order("sort").order("id");
  echec(error);
  return (data as LigneCategorie[]).map(versCategorie);
}

async function portefeuilles(archives = false): Promise<Wallet[]> {
  const { data, error } = await supabase.rpc("soldes", { p_archives: archives });
  echec(error);
  return (data as LigneSolde[]).map(versPortefeuille);
}

async function portefeuille(id: number) {
  const w = (await portefeuilles(true)).find((x) => x.id === id);
  if (!w) throw new ApiError(404, "Portefeuille introuvable");
  return w;
}

async function projets(): Promise<Project[]> {
  const { data, error } = await supabase.rpc("projets", { p_aujourdhui: todayIso() });
  echec(error);
  // Comme avant : en cours d'abord, par date cible, sans date à la fin.
  return (data as LigneProjet[]).map(versProjet).sort((a, b) =>
    Number(a.done) - Number(b.done) || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.id - b.id);
}

async function projet(id: number) {
  const p = (await projets()).find((x) => x.id === id);
  if (!p) throw new ApiError(404, "Projet introuvable");
  return p;
}

async function budgets(month: string) {
  const { data, error } = await supabase.rpc("lignes_budget", { p_mois: month });
  echec(error);
  const lines: BudgetLine[] = (data as { category_id: number; category_name: string; icon: string | null; amount: number; spent: number; ratio: number; status: BudgetLine["status"] }[])
    .map((r) => ({ categoryId: r.category_id, categoryName: r.category_name, icon: r.icon, amount: r.amount, spent: r.spent, ratio: r.ratio, status: r.status }));
  const budgetees = lines.filter((b) => b.amount > 0);
  const budget = budgetees.reduce((s, b) => s + b.amount, 0);
  const spent = budgetees.reduce((s, b) => s + b.spent, 0);
  const { count, error: e2 } = await supabase.from("budgets").select("*", { count: "exact", head: true }).eq("month", shiftMonth(month, -1));
  echec(e2);
  return { lines, summary: { month, budget, spent, saved: budget - spent, hasBudgets: budgetees.length > 0, previousMonthHasBudgets: (count ?? 0) > 0 } };
}

async function fixerBudget(categoryId: number, month: string, amount: number) {
  const { error } = amount <= 0
    ? await supabase.from("budgets").delete().eq("category_id", categoryId).eq("month", month)
    : await supabase.from("budgets").upsert({ category_id: categoryId, month, amount }, { onConflict: "foyer_id,category_id,month" });
  echec(error);
}

async function recurrences(): Promise<Recurrence[]> {
  const [{ data, error }, cats, ws] = await Promise.all([
    supabase.from("recurrences").select("*").order("next_date").order("id"),
    categories(),
    portefeuilles(true),
  ]);
  echec(error);
  const nomCat = new Map(cats.map((c) => [c.id, c.name]));
  const nomW = new Map(ws.map((w) => [w.id, w.name]));
  return (data as { id: number; label: string; type: Recurrence["type"]; amount: number; frequency: Recurrence["frequency"]; day: number; wallet_id: number; to_wallet_id: number | null; category_id: number | null; next_date: string; active: boolean }[])
    .map((r) => ({
      id: r.id, label: r.label, type: r.type, amount: r.amount, frequency: r.frequency, day: r.day, walletId: r.wallet_id, toWalletId: r.to_wallet_id,
      categoryId: r.category_id, nextDate: r.next_date, active: r.active, categoryName: r.category_id ? nomCat.get(r.category_id) ?? null : null,
      walletName: nomW.get(r.wallet_id) ?? "",
    }));
}

/** Les échéances dues deviennent des opérations ; appelé à l'ouverture et après chaque récurrence modifiée. */
export async function executerEcheances(): Promise<number> {
  const { data, error } = await supabase.rpc("executer_echeances", { p_aujourdhui: todayIso() });
  echec(error);
  return Number(data ?? 0);
}

const champsTransaction = (v: z.infer<typeof transactionInput>) => ({
  type: v.type, amount: v.amount, date: v.date, time: v.time ?? null, wallet_id: v.walletId,
  to_wallet_id: v.type === "transfer" ? v.toWalletId : null, category_id: v.type === "transfer" ? null : v.categoryId,
  project_id: v.projectId, label: v.label, note: v.note, payment_method: v.type === "transfer" ? null : v.paymentMethod ?? null,
});

// ---------- Les routes ----------

type Q = URLSearchParams;
type Route = [méthode: string, motif: RegExp, (p: string[], q: Q, body: unknown) => Promise<unknown>];

const routes: Route[] = [
  // Accueil
  ["GET", /^\/api\/home$/, async (_p, q) => {
    const { data, error } = await supabase.rpc("accueil", { p_mois: q.get("month") ?? todayIso().slice(0, 7), p_aujourdhui: todayIso() });
    echec(error);
    return data as HomeSummary;
  }],

  // Portefeuilles
  ["GET", /^\/api\/wallets$/, (_p, q) => portefeuilles(q.get("all") === "1")],
  ["POST", /^\/api\/wallets$/, async (_p, _q, body) => {
    const v = valider(walletInput, body);
    const { data, error } = await supabase.from("wallets").insert({ name: v.name, type: v.type, initial_balance: v.initialBalance }).select("id").single();
    echec(error);
    return portefeuille((data as { id: number }).id);
  }],
  ["PUT", /^\/api\/wallets\/(\d+)$/, async ([id], _q, body) => {
    const v = valider(walletInput, body);
    const { error } = await supabase.from("wallets").update({ name: v.name, type: v.type, initial_balance: v.initialBalance }).eq("id", Number(id));
    echec(error);
    return portefeuille(Number(id));
  }],
  ["DELETE", /^\/api\/wallets\/(\d+)$/, async ([id]) => {
    const { data, error } = await supabase.rpc("supprimer_portefeuille", { p_wallet: Number(id) });
    echec(error);
    if (data === "not_found") throw new ApiError(404, "Introuvable");
    return { result: data };
  }],
  ["POST", /^\/api\/wallets\/(\d+)\/adjust$/, async ([id], _q, body) => {
    const { realBalance } = body as { realBalance: number };
    if (!Number.isInteger(realBalance)) throw new ApiError(400, "Solde invalide");
    const { data, error } = await supabase.rpc("ajuster_portefeuille", { p_wallet: Number(id), p_solde_reel: realBalance, p_date: todayIso() });
    echec(error);
    return { adjustment: data, wallet: await portefeuille(Number(id)) };
  }],

  // Catégories
  ["GET", /^\/api\/categories$/, () => categories()],
  ["POST", /^\/api\/categories$/, async (_p, _q, body) => {
    const v = valider(categoryInput, body);
    const toutes = await categories();
    const kind = v.parentId ? toutes.find((c) => c.id === v.parentId)?.kind ?? v.kind : v.kind;
    const sort = Math.max(0, ...toutes.map((c) => c.sort)) + 1;
    const { data, error } = await supabase.from("categories").insert({ name: v.name, kind, parent_id: v.parentId, icon: v.icon, sort }).select("*").single();
    echec(error);
    return versCategorie(data as LigneCategorie);
  }],
  ["PUT", /^\/api\/categories\/(\d+)$/, async ([id], _q, body) => {
    const v = valider(categoryInput, body);
    const { data, error } = await supabase.from("categories").update({ name: v.name, icon: v.icon, parent_id: v.parentId }).eq("id", Number(id)).select("*").single();
    echec(error);
    return versCategorie(data as LigneCategorie);
  }],
  ["PUT", /^\/api\/categories\/(\d+)\/avoidable$/, async ([id], _q, body) => {
    const { data, error } = await supabase.from("categories").update({ avoidable: Boolean((body as { avoidable: boolean }).avoidable) }).eq("id", Number(id)).select("*").single();
    echec(error);
    return versCategorie(data as LigneCategorie);
  }],
  ["DELETE", /^\/api\/categories\/(\d+)$/, async ([id], q) => {
    const { data, error } = await supabase.rpc("supprimer_categorie", { p_categorie: Number(id), p_vers: entier(q.get("reassignTo")) ?? null });
    echec(error);
    if (!data) throw new ApiError(400, "Catégorie introuvable ou technique");
    return { ok: true };
  }],

  // Transactions — les routes fixes avant /:id
  ["GET", /^\/api\/transactions$/, async (_p, q) => {
    let r = supabase.from("transactions_detail").select("*");
    const month = q.get("month");
    if (month) r = r.gte("date", `${month}-01`).lte("date", addDays(`${shiftMonth(month, 1)}-01`, -1));
    const from = q.get("from"), to = q.get("to");
    if (from && to) r = r.gte("date", from).lte("date", to);
    const type = q.get("type");
    if (type === "expense" || type === "income" || type === "transfer") r = r.eq("type", type);
    const status = q.get("status");
    if (status === "confirmed" || status === "to_verify") r = r.eq("status", status);
    const cat = entier(q.get("categoryId"));
    if (cat) r = r.or(`category_id.eq.${cat},category_parent_id.eq.${cat}`);
    const wallet = entier(q.get("walletId"));
    if (wallet) r = r.or(`wallet_id.eq.${wallet},to_wallet_id.eq.${wallet}`);
    const texte = pourRecherche(q.get("q") ?? "");
    if (texte) r = r.or(`label.ilike.%${texte}%,note.ilike.%${texte}%,category_name.ilike.%${texte}%`);
    r = r.order("date", { ascending: false }).order("id", { ascending: false });
    const limit = entier(q.get("limit"));
    const lignes = limit
      ? await toutesLesLignes<LigneTransaction>((a, b) => r.range(a, Math.min(b, limit - 1)))
      : await toutesLesLignes<LigneTransaction>((a, b) => r.range(a, b));
    return lignes.slice(0, limit ?? lignes.length).map(versTransaction);
  }],
  ["GET", /^\/api\/transactions\/labels$/, async (_p, q) => {
    const { data, error } = await supabase.rpc("suggestions_libelles", { p_texte: q.get("q") ?? "", p_limite: 8 });
    echec(error);
    return (data as { label: string; category_id: number | null; wallet_id: number; type: LabelSuggestion["type"]; payment_method: LabelSuggestion["paymentMethod"] }[])
      .map((r): LabelSuggestion => ({ label: r.label, categoryId: r.category_id, walletId: r.wallet_id, type: r.type, paymentMethod: r.payment_method ?? null }));
  }],
  ["GET", /^\/api\/transactions\/habits$/, async (_p, q): Promise<HabitSuggestion[]> => {
    const type = q.get("type");
    if (type !== "expense" && type !== "income") return [];
    const today = todayIso();
    let r = supabase.from("transactions_detail").select("label, category_id, wallet_id, payment_method, amount, date")
      .eq("type", type).neq("label", "").gte("date", addDays(today, -365)).is("technical_key", null);
    const cat = entier(q.get("categoryId"));
    if (cat) {
      // La catégorie, ses sous-catégories et sa catégorie parente.
      const toutes = await categories();
      const parent = toutes.find((c) => c.id === cat)?.parentId;
      const ids = [cat, ...toutes.filter((c) => c.parentId === cat).map((c) => c.id), ...(parent ? [parent] : [])];
      r = r.in("category_id", ids);
    }
    const { data, error } = await r.order("date", { ascending: false }).order("id", { ascending: false }).limit(2000);
    echec(error);
    return classerHabitudes(data as LigneHabitude[], { amount: entier(q.get("amount")) ?? null, today });
  }],
  ["GET", /^\/api\/transactions\/to-verify-count$/, async () => {
    const { count, error } = await supabase.from("transactions").select("*", { count: "exact", head: true }).eq("status", "to_verify");
    echec(error);
    return { count: count ?? 0 };
  }],
  ["POST", /^\/api\/transactions\/bulk$/, async (_p, _q, body) => {
    const { ids, action, categoryId } = valider(bulkTransactionInput, body);
    if (action === "recategorize" && categoryId === null) throw new ApiError(400, "Choisissez une catégorie");
    let done = 0;
    for (const lot of paquets(ids)) {
      let req;
      if (action === "recategorize") {
        req = supabase.from("transactions").update({ category_id: categoryId, status: "confirmed" }).in("id", lot).neq("type", "transfer");
      } else if (action === "delete") {
        req = supabase.from("transactions").delete().in("id", lot);
      } else {
        req = supabase.from("transactions").update({ status: "confirmed" }).in("id", lot);
      }
      const { data, error } = await req.select("id, photo_path");
      echec(error);
      if (action === "delete") await supprimerPhotos((data as { photo_path: string | null }[]).map((x) => x.photo_path));
      done += (data ?? []).length;
    }
    return { done };
  }],
  ["POST", /^\/api\/transactions\/(\d+)\/confirm$/, async ([id]) => {
    const { error } = await supabase.from("transactions").update({ status: "confirmed" }).eq("id", Number(id));
    echec(error);
    return transaction(Number(id));
  }],
  ["GET", /^\/api\/transactions\/(\d+)\/context$/, async ([id]) => {
    const t = await transaction(Number(id));
    if (t.technical || !t.categoryId || t.type === "transfer") return { month: null, sub: null, parent: null };
    const { data, error } = await supabase.rpc("contexte_categorie", { p_categorie: t.categoryId, p_mois: monthOf(t.date), p_type: t.type });
    echec(error);
    return data ?? { month: null, sub: null, parent: null };
  }],
  ["POST", /^\/api\/transactions\/(\d+)\/photo$/, async ([id], _q, body) => {
    const fichier = body instanceof FormData ? body.get("photo") : null;
    if (!(fichier instanceof Blob)) throw new ApiError(400, "Photo manquante");
    if (fichier.size > 10 * 1024 * 1024) throw new ApiError(400, "Photo trop lourde (10 Mo max)");
    const octets = new Uint8Array(await fichier.arrayBuffer());
    const type = typeImage(octets);
    if (!type) throw new ApiError(400, "Ce fichier n'est pas une photo (JPEG, PNG ou WebP).");
    const { data: avant, error: e1 } = await supabase.from("transactions").select("photo_path").eq("id", Number(id)).single();
    echec(e1);
    const chemin = `${await monFoyer()}/${id}-${Date.now()}.${EXTENSION_IMAGE[type]}`;
    const { error: e2 } = await supabase.storage.from(BUCKET).upload(chemin, octets, { contentType: type, upsert: false });
    if (e2) throw new ApiError(400, e2.message);
    const { error: e3 } = await supabase.from("transactions").update({ photo_path: chemin }).eq("id", Number(id));
    echec(e3);
    await supprimerPhotos([(avant as { photo_path: string | null }).photo_path]);
    return transaction(Number(id));
  }],
  ["DELETE", /^\/api\/transactions\/(\d+)\/photo$/, async ([id]) => {
    const { data, error } = await supabase.from("transactions").select("photo_path").eq("id", Number(id)).single();
    echec(error);
    echec((await supabase.from("transactions").update({ photo_path: null }).eq("id", Number(id))).error);
    await supprimerPhotos([(data as { photo_path: string | null }).photo_path]);
    return transaction(Number(id));
  }],
  ["GET", /^\/api\/transactions\/(\d+)$/, ([id]) => transaction(Number(id))],
  ["POST", /^\/api\/transactions$/, async (_p, _q, body) => {
    const v = valider(transactionInput, body);
    const { data, error } = await supabase.from("transactions").insert(champsTransaction(v)).select("id").single();
    echec(error);
    return transaction((data as { id: number }).id);
  }],
  ["PUT", /^\/api\/transactions\/(\d+)$/, async ([id], _q, body) => {
    const v = valider(transactionInput, body);
    // Toute modification par l'utilisateur confirme l'opération et apprend la règle.
    const { error } = await supabase.from("transactions").update({ ...champsTransaction(v), status: "confirmed" }).eq("id", Number(id));
    echec(error);
    return transaction(Number(id));
  }],
  ["DELETE", /^\/api\/transactions\/(\d+)$/, async ([id]) => {
    const { data, error } = await supabase.from("transactions").delete().eq("id", Number(id)).select("id, photo_path");
    echec(error);
    if (!data?.length) throw new ApiError(404, "Introuvable");
    await supprimerPhotos((data as { photo_path: string | null }[]).map((x) => x.photo_path));
    return { ok: true };
  }],

  // Récurrences
  ["GET", /^\/api\/recurrences$/, () => recurrences()],
  ["POST", /^\/api\/recurrences$/, async (_p, _q, body) => {
    const v = valider(recurrenceInput, body);
    const { data, error } = await supabase.from("recurrences").insert({
      label: v.label, type: v.type, amount: v.amount, frequency: v.frequency, day: v.day, wallet_id: v.walletId,
      to_wallet_id: v.type === "transfer" ? v.toWalletId : null, category_id: v.type === "transfer" ? null : v.categoryId,
      next_date: nextOccurrence(v.frequency, v.day, v.startDate ?? todayIso()), active: v.active,
    }).select("id").single();
    echec(error);
    await executerEcheances();
    return (await recurrences()).find((r) => r.id === (data as { id: number }).id);
  }],
  ["PUT", /^\/api\/recurrences\/(\d+)$/, async ([id], _q, body) => {
    const v = valider(recurrenceInput, body);
    const existante = (await recurrences()).find((r) => r.id === Number(id));
    if (!existante) throw new ApiError(404, "Introuvable");
    const change = existante.frequency !== v.frequency || existante.day !== v.day || v.startDate;
    const { error } = await supabase.from("recurrences").update({
      label: v.label, type: v.type, amount: v.amount, frequency: v.frequency, day: v.day, wallet_id: v.walletId,
      to_wallet_id: v.type === "transfer" ? v.toWalletId : null, category_id: v.type === "transfer" ? null : v.categoryId,
      next_date: change ? nextOccurrence(v.frequency, v.day, v.startDate ?? todayIso()) : existante.nextDate, active: v.active,
    }).eq("id", Number(id));
    echec(error);
    await executerEcheances();
    return (await recurrences()).find((r) => r.id === Number(id));
  }],
  ["DELETE", /^\/api\/recurrences\/(\d+)$/, async ([id]) => {
    const { error } = await supabase.from("recurrences").delete().eq("id", Number(id));
    echec(error);
    return { ok: true };
  }],

  // Budgets
  ["GET", /^\/api\/budgets$/, (_p, q) => budgets(q.get("month") ?? todayIso().slice(0, 7))],
  ["PUT", /^\/api\/budgets$/, async (_p, _q, body) => {
    const b = valider(budgetInput, body);
    await fixerBudget(b.categoryId, b.month, b.amount);
    return budgets(b.month);
  }],
  ["POST", /^\/api\/budgets\/copy$/, async (_p, _q, body) => {
    const b = valider(budgetCopyInput, body);
    const { data, error } = await supabase.from("budgets").select("category_id, amount").eq("month", b.from);
    echec(error);
    const lignes = (data as { category_id: number; amount: number }[]).map((x) => ({ ...x, month: b.to }));
    if (!lignes.length) return { copied: 0 };
    // Sans écraser les budgets déjà saisis pour le mois cible.
    const { data: inserees, error: e2 } = await supabase.from("budgets")
      .upsert(lignes, { onConflict: "foyer_id,category_id,month", ignoreDuplicates: true }).select("category_id");
    echec(e2);
    return { copied: (inserees ?? []).length };
  }],
  ["POST", /^\/api\/budgets\/apply$/, async (_p, _q, body) => {
    const b = valider(budgetApplyInput, body);
    for (const i of b.items) await fixerBudget(i.categoryId, b.month, i.amount);
    return budgets(b.month);
  }],
  ["GET", /^\/api\/budgets\/suggest$/, pasEncore(3, "La suggestion de budgets")],

  // Projets
  ["GET", /^\/api\/projects$/, () => projets()],
  ["POST", /^\/api\/projects$/, async (_p, _q, body) => {
    const v = valider(projectInput, body);
    const { data, error } = await supabase.from("projects").insert({ name: v.name, target: v.target, due_date: v.dueDate, wallet_id: v.walletId }).select("id").single();
    echec(error);
    return projet((data as { id: number }).id);
  }],
  ["PUT", /^\/api\/projects\/(\d+)$/, async ([id], _q, body) => {
    const v = valider(projectInput, body);
    const { error } = await supabase.from("projects").update({ name: v.name, target: v.target, due_date: v.dueDate, wallet_id: v.walletId }).eq("id", Number(id));
    echec(error);
    return projet(Number(id));
  }],
  ["DELETE", /^\/api\/projects\/(\d+)$/, async ([id]) => {
    const { error } = await supabase.from("projects").delete().eq("id", Number(id));
    echec(error);
    return { ok: true };
  }],
  ["POST", /^\/api\/projects\/(\d+)\/contribute$/, async ([id], _q, body) => {
    const b = valider(contributeInput, body);
    const p = await projet(Number(id));
    if (b.fromWalletId === p.walletId) throw new ApiError(400, "Choisir un portefeuille source différent de celui du projet");
    const { error } = await supabase.from("transactions").insert({
      type: "transfer", amount: b.amount, date: b.date ?? todayIso(), wallet_id: b.fromWalletId, to_wallet_id: p.walletId,
      project_id: p.id, label: `Projet : ${p.name}`,
    });
    echec(error);
    return projet(p.id);
  }],

  // Règles apprises
  ["GET", /^\/api\/rules$/, async () => {
    const [{ data, error }, cats] = await Promise.all([
      supabase.from("category_rules").select("id, pattern, category_id, hits").order("updated_at", { ascending: false }),
      categories(),
    ]);
    echec(error);
    const nom = new Map(cats.map((c) => [c.id, c.name]));
    return (data as { id: number; pattern: string; category_id: number; hits: number }[])
      .map((r) => ({ id: r.id, pattern: r.pattern, categoryId: r.category_id, categoryName: nom.get(r.category_id) ?? "", hits: r.hits }));
  }],
  ["DELETE", /^\/api\/rules\/(\d+)$/, async ([id]) => {
    const { error } = await supabase.from("category_rules").delete().eq("id", Number(id));
    echec(error);
    return { ok: true };
  }],
  ["GET", /^\/api\/categorize$/, async (_p, q): Promise<CategorySuggestion> => {
    const { data, error } = await supabase.rpc("regle_pour", { p_libelle: q.get("label") ?? "" });
    echec(error);
    const r = (data as { category_id: number; wallet_id: number | null }[])[0];
    return r ? { categoryId: r.category_id, walletId: r.wallet_id, source: "rule" } : { categoryId: null, walletId: null, source: "none" };
  }],

  // Réglages du foyer
  ["GET", /^\/api\/settings$/, async () => {
    const { data, error } = await supabase.from("settings").select("key, value");
    echec(error);
    const out: Record<string, string> = { aiKey: "" };
    for (const r of data as { key: string; value: string }[]) out[r.key] = r.value;
    return out;
  }],
  ["PUT", /^\/api\/settings$/, async (_p, _q, body) => {
    const lignes = Object.entries(body as Record<string, unknown>)
      .filter(([k, v]) => typeof v === "string" && k.length < 40 && k !== "aiKey")
      .map(([key, value]) => ({ key, value: value as string }));
    if ((body as Record<string, unknown>).aiKey) throw new ApiError(501, "La clé IA sera enregistrée côté serveur à l'étape 3 de la migration.");
    if (lignes.length) echec((await supabase.from("settings").upsert(lignes, { onConflict: "foyer_id,key" })).error);
    return { ok: true };
  }],
  ["GET", /^\/api\/version$/, async () => ({ commit: __VERSION__.commit, date: __VERSION__.date, interfaceLe: __VERSION__.construite })],

  // Pas encore migré
  ...routesEtape2(),
  ["GET", /^\/api\/ai\/usage$/, async () => ({ mois: todayIso().slice(0, 7), appels: 0, entree: 0, sortie: 0, centsUsd: 0, parFonction: [], plafondCents: 500, consommeCents: 0, depasse: false })],
  ["GET", /^\/api\/ai\//, pasEncore(3, "L'IA")],
  ["POST", /^\/api\/ai\//, pasEncore(3, "L'IA")],
  ["GET", /^\/api\/coach\//, pasEncore(3, "Le coach")],
  ["POST", /^\/api\/coach\//, pasEncore(3, "Le coach")],
  ["DELETE", /^\/api\/coach\//, pasEncore(3, "Le coach")],
];

// ---------- Étape 2 : suivi, import de relevé, sauvegarde ----------

const periode = (v: string | null): PeriodKey => (PERIOD_KEYS.includes(v as PeriodKey) ? (v as PeriodKey) : "1m");

async function categoriesSuivi(): Promise<CategorieSuivi[]> {
  return (await categories()).map((c) => ({ id: c.id, name: c.name, icon: c.icon, parent_id: c.parentId, kind: c.kind, sort: c.sort, avoidable: c.avoidable }));
}

/** Totaux par jour et par catégorie entre deux dates : tout le Suivi se calcule à partir d'eux. */
async function lignesJour(du: string, au: string): Promise<LigneJour[]> {
  return toutesLesLignes<LigneJour>((a, b) => supabase.rpc("totaux_jour", { p_du: du, p_au: au }).range(a, b));
}

// Import de relevé

/** Le fichier tel que la banque l'a écrit : UTF-8, ou Windows-1252 pour les relevés plus anciens. */
async function lireCsv(fichier: Blob): Promise<string> {
  const octets = new Uint8Array(await fichier.arrayBuffer());
  const utf8 = new TextDecoder("utf-8").decode(octets);
  return utf8.includes("\uFFFD") ? new TextDecoder("windows-1252").decode(octets) : utf8;
}

const cleBanque = (bank: string) => `importMapping:${bank.trim().toLowerCase()}`;

async function reglage(cle: string): Promise<string | null> {
  const { data, error } = await supabase.from("settings").select("value").eq("key", cle).maybeSingle();
  echec(error);
  return (data as { value: string } | null)?.value ?? null;
}

async function correspondanceMemorisee(bank: string): Promise<ImportColumnMapping | null> {
  const brut = await reglage(cleBanque(bank));
  if (!brut) return null;
  const m = JSON.parse(brut) as ImportColumnMapping;
  return { ...m, category: m.category ?? null, subCategory: m.subCategory ?? null };
}

async function banquesConnues(): Promise<string[]> {
  const { data, error } = await supabase.from("settings").select("key").like("key", "importMapping:%");
  echec(error);
  return (data as { key: string }[]).map((r) => r.key.slice("importMapping:".length));
}

async function reglesApprises() {
  return rapprocheur(await toutesLesLignes<RuleRow>((a, b) =>
    supabase.from("category_rules").select("pattern, category_id, wallet_id").order("id").range(a, b)));
}

/** Doublon = même montant, même sens, date à ± 3 jours, libellé proche — dans le fichier ou déjà en base. */
async function marquerDoublons(rows: ImportPreviewRow[], walletId: number) {
  const dates = rows.filter((r) => !r.error && r.date).map((r) => r.date!).sort();
  if (!dates.length) return;
  const existantes = await toutesLesLignes<{ label: string; type: TxType; amount: number; date: string }>((a, b) =>
    supabase.from("transactions").select("label, type, amount, date").eq("wallet_id", walletId)
      .gte("date", addDays(dates[0], -3)).lte("date", addDays(dates[dates.length - 1], 3)).order("id").range(a, b));
  const parMontant = new Map<string, { label: string; date: string }[]>();
  for (const e of existantes) {
    const k = `${e.type}|${e.amount}`;
    parMontant.set(k, [...(parMontant.get(k) ?? []), e]);
  }
  const vus = new Set<string>();
  for (const r of rows) {
    if (r.error || !r.date || r.amount === null) continue;
    const norm = normalizeLabel(r.label);
    const cle = `${r.date}|${r.amount}|${norm}`;
    if (vus.has(cle)) { r.duplicate = true; continue; }
    vus.add(cle);
    const debut = addDays(r.date, -3), fin = addDays(r.date, 3);
    r.duplicate = (parMontant.get(`${r.type}|${Math.abs(r.amount)}`) ?? [])
      .filter((c) => c.date >= debut && c.date <= fin)
      .some((c) => {
        const cn = normalizeLabel(c.label);
        return !cn || !norm || cn === norm || cn.includes(norm) || norm.includes(cn);
      });
  }
}

/** Sans IA (étape 3), une ligne qu'aucune règle ni la banque ne classe va dans « Divers » ou « Autres revenus ». */
function categorieParDefaut(cats: Category[], type: TxType): number {
  const nom = type === "income" ? "Autres revenus" : "Divers";
  return cats.find((c) => c.name === nom && !c.technicalKey)?.id
    ?? cats.find((c) => c.kind === (type === "income" ? "income" : "expense") && c.parentId !== null)!.id;
}

async function lotImport(id: number): Promise<ImportBatch> {
  const lots = await listeImports();
  const lot = lots.find((x) => x.id === id);
  if (!lot) throw new ApiError(404, "Import introuvable");
  return lot;
}

async function listeImports(): Promise<ImportBatch[]> {
  const { data, error } = await supabase.rpc("imports_detail");
  echec(error);
  return (data as { id: number; bank: string; wallet_id: number; wallet_name: string; file_name: string; created_count: number; skipped_count: number; created_at: string; remaining: number }[])
    .map((r) => ({ id: r.id, bank: r.bank, walletId: r.wallet_id, walletName: r.wallet_name, fileName: r.file_name, createdCount: r.created_count, skippedCount: r.skipped_count, createdAt: r.created_at, remaining: r.remaining }));
}

// Sauvegarde

const TABLES_SAUVEGARDE = ["wallets", "categories", "projects", "recurrences", "imports", "transactions", "budgets", "settings", "category_rules", "chat_messages"] as const;
/** Colonnes propres à la version en ligne, inutiles dans un fichier de sauvegarde. */
const COLONNES_INTERNES = ["foyer_id", "created_by", "user_id"];

async function sauvegarde(): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = { version: [2] };
  for (const t of TABLES_SAUVEGARDE) {
    const cle = t === "budgets" ? "category_id" : t === "settings" ? "key" : "id";
    const lignes = await toutesLesLignes<Record<string, unknown>>((a, b) => supabase.from(t).select("*").order(cle).range(a, b));
    out[t] = lignes.map((l) => Object.fromEntries(Object.entries(l).filter(([k]) => !COLONNES_INTERNES.includes(k))));
  }
  return out;
}

function celluleCsv(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function routesEtape2(): Route[] {
  return [
    // Suivi
    ["GET", /^\/api\/stats\/period$/, async (_p, q) => {
      const type = q.get("type") === "income" ? "income" : "expense";
      const key = periode(q.get("period"));
      const r = periodRange(key, todayIso());
      const [lignes, cats] = await Promise.all([lignesJour(r.prevFrom, r.to), categoriesSuivi()]);
      return calculerPeriode(lignes, cats, type, key, todayIso());
    }],
    ["GET", /^\/api\/stats\/avoidable$/, async (_p, q) => {
      const key = periode(q.get("period"));
      const today = todayIso();
      const r = periodRange(key, today);
      const { from, to } = bornesLecture(today);
      const [lignes, cats, projetsEnCours, { data: top, error }] = await Promise.all([
        lignesJour(from, to), categoriesSuivi(), projets(),
        supabase.rpc("libelles_evitables", { p_du: r.from, p_au: r.to }),
      ]);
      echec(error);
      const topLabels = (top as { label: string; count: number; total: number; category_name: string }[])
        .map((x) => ({ label: x.label, count: Number(x.count), total: x.total, categoryName: x.category_name }));
      return calculerEvitables(lignes, cats, key, today, projetsEnCours.find((p) => !p.done)?.name ?? null, topLabels);
    }],
    // L'objectif rédigé par l'IA arrive à l'étape 3 ; d'ici là, l'objectif calculé.
    ["GET", /^\/api\/stats\/avoidable\/goal$/, async (_p, q) => {
      const s = (await appeler<{ goal: unknown }>("GET", `/api/stats/avoidable?period=${periode(q.get("period"))}`));
      return { goal: s.goal };
    }],
    ["GET", /^\/api\/stats$/, async (_p, q) => {
      const month = q.get("month") ?? todayIso().slice(0, 7);
      const [lignes, cats] = await Promise.all([lignesJour(`${shiftMonth(month, -11)}-01`, addDays(`${shiftMonth(month, 1)}-01`, -1)), categoriesSuivi()]);
      return calculerStats(lignes, cats, month);
    }],

    // Import de relevé
    ["POST", /^\/api\/import\/preview$/, async (_p, _q, body) => {
      if (!(body instanceof FormData)) throw new ApiError(400, "Fichier manquant");
      const fichier = body.get("file");
      if (!(fichier instanceof Blob)) throw new ApiError(400, "Fichier manquant");
      if (fichier.size > 5 * 1024 * 1024) throw new ApiError(400, "Fichier trop lourd (5 Mo max)");
      const walletId = entier(String(body.get("walletId") ?? ""));
      if (!walletId) throw new ApiError(400, "Portefeuille manquant");
      const bank = String(body.get("bank") ?? "").trim() || null;
      const brut = body.get("mapping");
      const force = typeof brut === "string" && brut ? (JSON.parse(brut) as ImportColumnMapping) : undefined;
      const csv = await lireCsv(fichier);
      const table = parseCsv(csv);
      if (table.length < 2) throw new ApiError(400, "Le fichier ne contient pas de lignes exploitables");
      const columns = table[0].map((c, i) => c.trim() || `Colonne ${i + 1}`);
      const corps = table.slice(1);
      const memorisee = bank ? await correspondanceMemorisee(bank) : null;
      const mapping = force ?? memorisee ?? detectMapping(columns, corps.slice(0, 20));
      const rows = applyMapping(corps, mapping);
      const [, cats, regles, banks] = await Promise.all([marquerDoublons(rows, walletId), categories(), reglesApprises(), banquesConnues()]);
      for (const r of rows) {
        if (r.error || r.type === null) { r.categorySource = null; continue; }
        if (regles.match(r.label)) r.categorySource = "rule";
        else if (matchBankCategory(cats, r.type, r.bankCategory, r.bankSubCategory) !== null) r.categorySource = "bank";
        else r.categorySource = "ai";
      }
      return { columns, sample: corps.slice(0, 5), mapping, savedMapping: memorisee !== null && !force, rows, csv, banks };
    }],
    ["POST", /^\/api\/import\/commit$/, async (_p, _q, body) => {
      const input = valider(importCommitInput, body);
      const rows = applyMapping(parseCsv(input.csv).slice(1), input.mapping);
      const [, cats, regles] = await Promise.all([marquerDoublons(rows, input.walletId), categories(), reglesApprises()]);
      echec((await supabase.from("settings").upsert({ key: cleBanque(input.bank), value: JSON.stringify(input.mapping) }, { onConflict: "foyer_id,key" })).error);
      const { data: lot, error } = await supabase.from("imports").insert({ bank: input.bank, wallet_id: input.walletId, file_name: input.fileName }).select("id").single();
      echec(error);
      const importId = (lot as { id: number }).id;
      let ignorees = 0;
      const lignes = [];
      for (const r of rows) {
        if (r.error || !r.date || r.amount === null || (input.skipDuplicates && r.duplicate)) { ignorees++; continue; }
        const regle = regles.match(r.label)?.categoryId ?? null;
        const categoryId = regle ?? matchBankCategory(cats, r.type!, r.bankCategory, r.bankSubCategory) ?? categorieParDefaut(cats, r.type!);
        lignes.push({
          type: r.type, amount: Math.abs(r.amount), date: r.date, wallet_id: input.walletId, category_id: categoryId,
          label: r.label, import_id: importId, status: regle !== null && input.autoConfirmKnown ? "confirmed" : "to_verify",
        });
      }
      for (const paquet of paquets(lignes, 500)) echec((await supabase.from("transactions").insert(paquet)).error);
      echec((await supabase.from("imports").update({ created_count: lignes.length, skipped_count: ignorees }).eq("id", importId)).error);
      return lotImport(importId);
    }],
    ["GET", /^\/api\/imports$/, () => listeImports()],
    ["DELETE", /^\/api\/imports\/(\d+)$/, async ([id]) => {
      await lotImport(Number(id));
      const { data, error } = await supabase.from("transactions").delete().eq("import_id", Number(id)).select("id");
      echec(error);
      echec((await supabase.from("imports").delete().eq("id", Number(id))).error);
      return { deleted: (data ?? []).length };
    }],

    // Sauvegarde
    ["GET", /^\/api\/backup\.json$/, () => sauvegarde()],
    ["POST", /^\/api\/backup\.json$/, async (_p, _q, body) => {
      const d = body as Record<string, unknown>;
      if (!d || !Array.isArray(d.transactions) || !Array.isArray(d.wallets)) throw new ApiError(400, "Fichier de sauvegarde invalide");
      const { data, error } = await supabase.rpc("restaurer_sauvegarde", { p_donnees: d });
      echec(error);
      return { ok: true, ...(data as object) };
    }],
    ["GET", /^\/api\/export\.csv$/, async () => {
      const lignes = await toutesLesLignes<LigneTransaction>((a, b) =>
        supabase.from("transactions_detail").select("*").order("date", { ascending: false }).order("id", { ascending: false }).range(a, b));
      const entete = ["date", "heure", "type", "montant", "categorie", "portefeuille", "vers_portefeuille", "moyen_paiement", "libelle", "note", "saisi_par"];
      const corps = lignes.map(versTransaction).map((t) =>
        [t.date, t.time, t.type, (t.amount / 100).toFixed(2).replace(".", ","), t.categoryName, t.walletName, t.toWalletName,
          t.paymentMethod === "card" ? "Carte" : t.paymentMethod === "cash" ? "Espèces" : null, t.label, t.note, t.createdBy].map(celluleCsv).join(";"));
      return "\uFEFF" + [entete.join(";"), ...corps].join("\n");
    }],
  ];
}

/** Point d'entrée unique : même signature que l'ancien fetch vers le serveur. */
export async function appeler<T>(methode: string, url: string, body?: unknown): Promise<T> {
  const u = new URL(url, "http://local");
  for (const [m, motif, traiter] of routes) {
    if (m !== methode) continue;
    const trouve = motif.exec(u.pathname);
    if (trouve) return (await traiter(trouve.slice(1), u.searchParams, body)) as T;
  }
  throw new ApiError(404, `Route inconnue : ${methode} ${u.pathname}`);
}
