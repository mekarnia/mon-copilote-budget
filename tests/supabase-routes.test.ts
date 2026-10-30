/**
 * Le routeur /api/… du navigateur, exercé contre une vraie base : Postgres avec
 * les migrations Supabase, servi par PostgREST comme le fait Supabase.
 *
 * Ce test ne tourne que si l'environnement est prêt (SUPABASE_LOCAL=1) :
 *   1. Postgres local avec la base « essai » : sh supabase/tests/lancer.sh
 *   2. PostgREST sur 127.0.0.1:3010 avec le secret JWT ci-dessous.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { PostgrestClient } from "@supabase/postgrest-js";

const SECRET = "secret-de-test-local-pour-postgrest-0123456789";
const PGREST = process.env.PGREST_URL ?? "http://127.0.0.1:3010";
const LUI = "00000000-0000-0000-0000-0000000000a1";
const ELLE = "00000000-0000-0000-0000-0000000000b2";
const INCONNU = "00000000-0000-0000-0000-0000000000c3";

function jwt(sub: string) {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const corps = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  return `${corps}.${crypto.createHmac("sha256", SECRET).update(corps).digest("base64url")}`;
}

// Le client du navigateur, remplacé par un client PostgREST au nom de l'utilisateur courant.
// Le stockage des photos est simulé en mémoire, avec la même règle que la
// politique Supabase : on n'écrit et ne lit que dans le dossier de son foyer.
const etat = vi.hoisted(() => ({ client: null as unknown, sub: "", fichiers: new Map<string, Uint8Array>(), foyerDe: (_s: string): string => "" }));
vi.mock("../src/lib/supabase", () => {
  const dossierAutorise = (chemin: string) => chemin.split("/")[0] === etat.foyerDe(etat.sub);
  const stockage = {
    from: () => ({
      upload: async (chemin: string, octets: Uint8Array) => {
        if (!dossierAutorise(chemin)) return { data: null, error: { message: "new row violates row-level security policy" } };
        etat.fichiers.set(chemin, octets);
        return { data: { path: chemin }, error: null };
      },
      remove: async (chemins: string[]) => {
        for (const c of chemins) if (dossierAutorise(c)) etat.fichiers.delete(c);
        return { data: [], error: null };
      },
      createSignedUrl: async (chemin: string) => ({ data: dossierAutorise(chemin) && etat.fichiers.has(chemin) ? { signedUrl: `signe://${chemin}` } : null, error: null }),
    }),
  };
  const auth = { getUser: async () => ({ data: { user: { id: etat.sub } }, error: null }) };
  return {
    supabase: new Proxy({}, {
      get: (_c, prop) => (prop === "storage" ? stockage : prop === "auth" ? auth : (etat.client as Record<string | symbol, unknown>)[prop]),
    }),
  };
});
const commeUtilisateur = (sub: string) => {
  etat.sub = sub;
  etat.client = new PostgrestClient(PGREST, { headers: { Authorization: `Bearer ${jwt(sub)}` } });
  return etat.client as PostgrestClient;
};

const { appeler } = await import("../src/lib/backend");
const { todayIso, shiftMonth, addDays } = await import("../shared/dates");
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const get = (url: string) => appeler<Json>("GET", url);
const post = (url: string, body?: unknown) => appeler<Json>("POST", url, body);
const put = (url: string, body?: unknown) => appeler<Json>("PUT", url, body);
const del = (url: string) => appeler<Json>("DELETE", url);

const psql = (sql: string) =>
  execFileSync("psql", ["-q", "-v", "ON_ERROR_STOP=1", "-c", "set client_min_messages = warning", "-h", process.env.PGHOST ?? "/var/tmp/pgtest", "-p", process.env.PGPORT ?? "5433", "-U", "postgres", "-d", "essai", "-tA", "-c", sql], { encoding: "utf8" });

etat.foyerDe = (sub: string) => psql(`select foyer_id from public.membres where user_id = '${sub}'`).trim();

const actif = process.env.SUPABASE_LOCAL === "1";
const mois = todayIso().slice(0, 7);

describe.skipIf(!actif)("routes /api servies par Supabase", () => {
  const ids: Record<string, number> = {};

  beforeAll(() => {
    psql(`truncate public.foyers cascade; delete from auth.users;
          insert into auth.users (id, email) values ('${LUI}', 'lui@essai'), ('${ELLE}', 'elle@essai'), ('${INCONNU}', 'x@essai');`);
  });
  afterAll(() => { psql("truncate public.foyers cascade; delete from auth.users;"); });

  it("crée le foyer avec ses catégories et ses portefeuilles", async () => {
    const c = commeUtilisateur(LUI);
    expect((await c.rpc("creer_foyer", { p_nom: "Essai", p_prenom: "Lui" })).error).toBeNull();
    const wallets = await get("/api/wallets") as unknown as Json[];
    expect(wallets.map((w) => w.name)).toEqual(["Compte courant", "Espèces", "Livret"]);
    for (const w of wallets) ids[w.name] = w.id;
    const cats = await get("/api/categories") as unknown as Json[];
    expect(cats).toHaveLength(47);
    for (const n of ["Supermarché", "Boulangerie", "Courses", "Loyer ou crédit", "Salaire"]) ids[n] = cats.find((x) => x.name === n)!.id;
  });

  it("enregistre une dépense avec les noms et l'auteur", async () => {
    const t = await post("/api/transactions", {
      type: "expense", amount: 4550, date: todayIso(), walletId: ids["Compte courant"], categoryId: ids["Supermarché"], label: "CB CARREFOUR 12/10",
    });
    expect(t).toMatchObject({ amount: 4550, walletName: "Compte courant", categoryName: "Supermarché", createdBy: "Lui", status: "confirmed", technical: false });
    ids.carrefour = t.id;
  });

  it("refuse une saisie invalide avec le message du formulaire", async () => {
    await expect(post("/api/transactions", { type: "expense", amount: 100, date: todayIso(), walletId: ids["Compte courant"] }))
      .rejects.toThrow(/Catégorie requise/);
  });

  it("classe un virement en catégorie technique et met les soldes à jour", async () => {
    const t = await post("/api/transactions", {
      type: "transfer", amount: 10000, date: todayIso(), walletId: ids["Compte courant"], toWalletId: ids["Livret"], categoryId: ids["Supermarché"],
    });
    expect(t.technical).toBe(true);
    expect(t.categoryName).toBe("Virement interne");
    const soldes = Object.fromEntries((await get("/api/wallets") as unknown as Json[]).map((w) => [w.name, w.balance]));
    expect(soldes).toEqual({ "Compte courant": -14550, "Espèces": 0, "Livret": 10000 });
  });

  it("calcule l'accueil sans compter le virement comme une dépense", async () => {
    const h = await get(`/api/home?month=${mois}`);
    expect(h).toMatchObject({ month: mois, expense: 4550, income: 0, walletsTotal: -4550 });
    expect(h.byCategory).toEqual([expect.objectContaining({ name: "Courses", total: 4550 })]);
  });

  it("cherche, filtre et propose les libellés", async () => {
    expect(await get(`/api/transactions?month=${mois}&q=carrefour`)).toHaveLength(1);
    expect(await get(`/api/transactions?month=${mois}&q=${encodeURIComponent("carre,four)(")}`)).toHaveLength(0);
    expect(await get(`/api/transactions?categoryId=${ids["Courses"]}`)).toHaveLength(1);
    expect(await get(`/api/transactions?walletId=${ids["Livret"]}`)).toHaveLength(1);
    const labels = await get("/api/transactions/labels?q=carr") as unknown as Json[];
    expect(labels[0]).toMatchObject({ label: "CB CARREFOUR 12/10", categoryId: ids["Supermarché"] });
  });

  it("apprend la règle et la retrouve pour un libellé voisin", async () => {
    expect(await get(`/api/categorize?label=${encodeURIComponent("CB CARREFOUR 14/10")}`)).toEqual({ categoryId: ids["Supermarché"], walletId: ids["Compte courant"], source: "rule" });
    expect(await get(`/api/categorize?label=inconnu`)).toMatchObject({ source: "none" });
    const regles = await get("/api/rules") as unknown as Json[];
    expect(regles).toEqual([expect.objectContaining({ pattern: "carrefour", categoryName: "Supermarché" })]);
  });

  it("donne le contexte de catégorie d'une transaction", async () => {
    const ctx = await get(`/api/transactions/${ids.carrefour}/context`);
    expect(ctx.parent).toMatchObject({ name: "Courses", total: 4550, count: 1 });
    expect(ctx.subs).toEqual([expect.objectContaining({ name: "Supermarché", total: 4550 })]);
  });

  it("partage tout avec le conjoint qui rejoint par le code", async () => {
    const code = psql("select code_invitation from public.foyers").trim();
    const c = commeUtilisateur(ELLE);
    expect((await c.rpc("rejoindre_foyer", { p_code: code.toLowerCase(), p_prenom: "Elle" })).error).toBeNull();
    expect(await get("/api/transactions")).toHaveLength(2);
    const t = await post("/api/transactions", { type: "expense", amount: 1200, date: todayIso(), walletId: ids["Espèces"], categoryId: ids["Boulangerie"], label: "Boulangerie Paul" });
    expect(t.createdBy).toBe("Elle");
    expect((await get(`/api/home?month=${mois}`)).expense).toBe(5750);
  });

  it("tient les budgets du mois et les copie sans écraser", async () => {
    const b = await put("/api/budgets", { categoryId: ids["Courses"], month: mois, amount: 5000 });
    expect(b.lines.find((l: Json) => l.categoryId === ids["Courses"])).toMatchObject({ amount: 5000, spent: 5750, status: "red" });
    expect(b.summary).toMatchObject({ budget: 5000, spent: 5750, saved: -750, hasBudgets: true });
    expect((await get(`/api/home?month=${mois}`)).redBudgets).toHaveLength(1);
    const suivant = shiftMonth(mois, 1);
    expect(await post("/api/budgets/copy", { from: mois, to: suivant })).toEqual({ copied: 1 });
    expect(await post("/api/budgets/copy", { from: mois, to: suivant })).toEqual({ copied: 0 });
    expect((await get(`/api/budgets?month=${suivant}`)).summary.previousMonthHasBudgets).toBe(true);
    await put("/api/budgets", { categoryId: ids["Courses"], month: suivant, amount: 0 });
    expect((await get(`/api/budgets?month=${suivant}`)).summary.hasBudgets).toBe(false);
  });

  it("alimente un projet par un virement", async () => {
    const p = await post("/api/projects", { name: "Vacances", target: 100000, dueDate: null, walletId: ids["Livret"] });
    await expect(post(`/api/projects/${p.id}/contribute`, { amount: 100, fromWalletId: ids["Livret"] })).rejects.toThrow(/différent/);
    const apres = await post(`/api/projects/${p.id}/contribute`, { amount: 20000, fromWalletId: ids["Compte courant"] });
    expect(apres).toMatchObject({ saved: 20000, remaining: 80000, done: false });
    expect((await get(`/api/home?month=${mois}`)).projects).toHaveLength(1);
  });

  it("rattrape les échéances d'une récurrence déclarée dans le passé", async () => {
    const debut = `${shiftMonth(mois, -2)}-01`;
    const r = await post("/api/recurrences", {
      label: "Loyer", type: "expense", amount: 80000, frequency: "monthly", day: 1, walletId: ids["Compte courant"], categoryId: ids["Loyer ou crédit"], startDate: debut,
    });
    expect(r).toMatchObject({ label: "Loyer", categoryName: "Loyer ou crédit", walletName: "Compte courant", nextDate: `${shiftMonth(mois, 1)}-01` });
    expect(await get(`/api/transactions?q=loyer`)).toHaveLength(3);
    expect(await get("/api/recurrences")).toHaveLength(1);
  });

  it("corrige un solde et archive un portefeuille utilisé", async () => {
    const a = await post(`/api/wallets/${ids["Espèces"]}/adjust`, { realBalance: 0 });
    expect(a.adjustment).toBe(1200);
    expect(a.wallet.balance).toBe(0);
    expect((await get(`/api/home?month=${mois}`)).income).toBe(0); // l'ajustement reste hors statistiques
    expect(await del(`/api/wallets/${ids["Espèces"]}`)).toEqual({ result: "archived" });
    expect(await get("/api/wallets")).toHaveLength(2);
    const neuf = await post("/api/wallets", { name: "Tirelire", type: "autre", initialBalance: 500 });
    expect(neuf.balance).toBe(500);
    expect(await del(`/api/wallets/${neuf.id}`)).toEqual({ result: "deleted" });
  });

  it("propose les habitudes à partir de deux saisies", async () => {
    await post("/api/transactions", { type: "expense", amount: 1300, date: addDays(todayIso(), -1), walletId: ids["Compte courant"], categoryId: ids["Boulangerie"], label: "Boulangerie Paul" });
    const h = await get(`/api/transactions/habits?type=expense&categoryId=${ids["Boulangerie"]}&amount=1250`) as unknown as Json[];
    expect(h[0]).toMatchObject({ label: "Boulangerie Paul", count: 2, categoryId: ids["Boulangerie"] });
  });

  it("valide, reclasse et supprime en masse", async () => {
    const liste = await get("/api/transactions?q=loyer") as unknown as Json[];
    psql(`update public.transactions set status = 'to_verify' where label = 'Loyer'`);
    expect((await get("/api/transactions/to-verify-count")).count).toBe(3);
    expect(await post("/api/transactions/bulk", { ids: [liste[0].id], action: "confirm" })).toEqual({ done: 1 });
    expect(await post("/api/transactions/bulk", { ids: [liste[1].id], action: "recategorize", categoryId: ids["Salaire"] })).toEqual({ done: 1 });
    expect(await post("/api/transactions/bulk", { ids: [liste[2].id], action: "delete" })).toEqual({ done: 1 });
    expect((await get("/api/transactions/to-verify-count")).count).toBe(0);
  });

  it("garde les réglages du foyer", async () => {
    await put("/api/settings", { plafondIaUsd: "8" });
    expect(await get("/api/settings")).toMatchObject({ plafondIaUsd: "8" });
    await expect(put("/api/settings", { aiKey: "sk-ant-x" })).rejects.toThrow(/étape 3/);
  });

  it("ne montre rien à un autre foyer", async () => {
    const c = commeUtilisateur(INCONNU);
    expect((await c.rpc("creer_foyer", { p_nom: "Autre", p_prenom: "X" })).error).toBeNull();
    expect(await get("/api/transactions")).toHaveLength(0);
    expect((await get(`/api/home?month=${mois}`)).expense).toBe(0);
    await expect(get(`/api/transactions/${ids.carrefour}`)).rejects.toThrow(/Introuvable/);
    await expect(del(`/api/transactions/${ids.carrefour}`)).rejects.toThrow(/Introuvable/);
    await expect(post("/api/transactions", { type: "expense", amount: 1, date: todayIso(), walletId: ids["Compte courant"], categoryId: ids["Supermarché"] }))
      .rejects.toThrow(/autre foyer/);
    commeUtilisateur(LUI);
    expect(await get(`/api/transactions/${ids.carrefour}`)).toMatchObject({ amount: 4550 });
  });

  it("signale clairement ce qui n'est pas encore migré", async () => {
    await expect(get("/api/coach/weekly")).rejects.toThrow(/étape 3/);
  });
});

describe.skipIf(!actif)("étape 2 : suivi, photos, import, sauvegarde", () => {
  const ids: Record<string, number> = {};
  const formulaire = (champs: Record<string, string | Blob>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(champs)) f.append(k, v);
    return f;
  };

  beforeAll(async () => {
    psql(`truncate public.foyers cascade; delete from auth.users;
          insert into auth.users (id, email) values ('${LUI}', 'lui@essai'), ('${INCONNU}', 'x@essai');`);
    const c = commeUtilisateur(INCONNU);
    await c.rpc("creer_foyer", { p_nom: "Autre", p_prenom: "X" });
    await commeUtilisateur(LUI).rpc("creer_foyer", { p_nom: "Essai", p_prenom: "Lui" });
    for (const w of await get("/api/wallets") as unknown as Json[]) ids[w.name] = w.id;
    for (const k of await get("/api/categories") as unknown as Json[]) ids[k.name] = k.id;
  });
  afterAll(() => { psql("truncate public.foyers cascade; delete from auth.users;"); });

  it("restaure une sauvegarde de la version PC avec les mêmes chiffres", async () => {
    const { memDb, catId, walletId } = await import("./helpers.js");
    const { createTransaction } = await import("../server/services/transactions.js");
    const { createRecurrence } = await import("../server/services/recurrences.js");
    const { createProject, contribute } = await import("../server/services/projects.js");
    const { setBudget } = await import("../server/services/budgets.js");
    const { exportJson } = await import("../server/services/backup.js");
    const { homeSummary } = await import("../server/services/home.js");
    const { periodStats } = await import("../server/services/periods.js");
    const db = memDb();
    const cc = walletId(db, "Compte courant"), esp = walletId(db, "Espèces");
    const ajout = (type: "expense" | "income", amount: number, date: string, cat: string, label: string, w = cc) =>
      createTransaction(db, { type, amount, date, walletId: w, toWalletId: null, categoryId: catId(db, cat), projectId: null, label, note: "" });
    ajout("income", 250000, `${mois}-01`, "Salaire", "Salaire");
    ajout("expense", 4550, todayIso(), "Supermarché", "CB CARREFOUR");
    ajout("expense", 3200, todayIso(), "Restaurant", "Pizzeria", esp);
    ajout("expense", 9900, `${shiftMonth(mois, -1)}-15`, "Restaurant", "Pizzeria");
    db.prepare("INSERT INTO categories (name, kind, parent_id, sort) VALUES ('Coiffeur enfants', 'expense', ?, 99)").run(catId(db, "Enfants"));
    ajout("expense", 1500, todayIso(), "Coiffeur enfants", "Salon");
    createTransaction(db, { type: "transfer", amount: 10000, date: todayIso(), walletId: cc, toWalletId: walletId(db, "Livret"), categoryId: null, projectId: null, label: "", note: "" });
    const p = createProject(db, { name: "Vacances", target: 200000, dueDate: null, walletId: walletId(db, "Livret") });
    contribute(db, p.id, 5000, cc);
    createRecurrence(db, { label: "Loyer", type: "expense", amount: 80000, frequency: "monthly", day: 28, walletId: cc, toWalletId: null, categoryId: catId(db, "Loyer ou crédit"), active: true });
    setBudget(db, catId(db, "Courses"), mois, 3000);
    db.prepare("INSERT INTO settings (key, value) VALUES ('aiKey', 'sk-ant-secret'), ('plafondIaUsd', '7')").run();
    const fichier = JSON.parse(JSON.stringify(exportJson(db)));
    fichier.settings.push({ key: "aiKey", value: "sk-ant-secret" }); // même un fichier trafiqué ne doit pas l'importer

    const r = await post("/api/backup.json", fichier);
    expect(r).toMatchObject({ ok: true, transactions: 7, ignorees: 0 }); // 5 saisies, 1 virement, 1 versement au projet

    const pc = homeSummary(db, mois);
    const enLigne = await get(`/api/home?month=${mois}`);
    for (const k of ["income", "expense", "remaining", "walletsTotal", "upcomingExpense"] as const) expect([k, enLigne[k]]).toEqual([k, pc[k]]);
    expect(enLigne.redBudgets).toHaveLength(pc.redBudgets.length);
    expect(enLigne.projects[0]).toMatchObject({ name: "Vacances", saved: 5000 });
    expect((await get("/api/categories") as unknown as Json[]).some((c) => c.name === "Coiffeur enfants")).toBe(true);
    expect(await get("/api/settings")).toMatchObject({ plafondIaUsd: "7", aiKey: "" });
    expect((await get("/api/rules") as unknown as Json[]).map((x) => x.pattern).sort()).toEqual(["carrefour", "pizzeria", "salon", "salaire"].sort());
    const suiviPc = periodStats(db, "expense", "1m");
    const suiviEnLigne = await get("/api/stats/period?type=expense&period=1m");
    expect(suiviEnLigne.total).toBe(suiviPc.total);
    expect(suiviEnLigne.byCategory.map((c: Json) => [c.name, c.total])).toEqual(suiviPc.byCategory.map((c) => [c.name, c.total]));
    for (const w of await get("/api/wallets") as unknown as Json[]) ids[w.name] = w.id;
    for (const k of await get("/api/categories") as unknown as Json[]) ids[k.name] = k.id;
  });

  it("ne touche pas aux données d'un autre foyer en restaurant", async () => {
    commeUtilisateur(INCONNU);
    expect(await get("/api/wallets")).toHaveLength(3);
    expect(await get("/api/transactions")).toHaveLength(0);
    commeUtilisateur(LUI);
  });

  it("refait l'aller-retour : sa propre sauvegarde se restaure à l'identique", async () => {
    const avant = await get(`/api/home?month=${mois}`);
    const fichier = await get("/api/backup.json");
    expect(fichier.transactions[0]).not.toHaveProperty("foyer_id");
    await post("/api/backup.json", fichier);
    // Les identifiants sont renumérotés à chaque restauration ; les chiffres et les noms, eux, ne bougent pas.
    const sansIds = (x: unknown): unknown => JSON.parse(JSON.stringify(x, (k, v) => (/^(id|categoryId|walletId|recurrenceId)$/.test(k) ? undefined : v)));
    expect(sansIds(await get(`/api/home?month=${mois}`))).toEqual(sansIds(avant));
    for (const w of await get("/api/wallets") as unknown as Json[]) ids[w.name] = w.id;
    for (const k of await get("/api/categories") as unknown as Json[]) ids[k.name] = k.id;
  });

  it("calcule le suivi, les mois et les dépenses évitables", async () => {
    const s = await get(`/api/stats?month=${mois}`);
    expect(s.monthly).toHaveLength(12);
    expect(s.monthly[11]).toMatchObject({ month: mois, income: 250000 });
    const ev = await get("/api/stats/avoidable?period=6m");
    expect(ev.total).toBe(3200 + 9900);
    expect(ev.topLabels[0]).toMatchObject({ label: "Pizzeria", count: 2, total: 13100 });
    expect(ev.goal).toMatchObject({ generatedBy: "template", projectName: "Vacances" });
    expect((await get("/api/stats/avoidable/goal?period=6m")).goal).toEqual(ev.goal);
  });

  it("joint, affiche et retire une photo de ticket dans le dossier du foyer", async () => {
    const t = (await get("/api/transactions?q=carrefour") as unknown as Json[])[0];
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(30).fill(0)]);
    await expect(post(`/api/transactions/${t.id}/photo`, formulaire({ photo: new Blob(["<html>"]) }))).rejects.toThrow(/pas une photo/);
    const avec = await post(`/api/transactions/${t.id}/photo`, formulaire({ photo: new Blob([jpeg], { type: "image/jpeg" }) }));
    const foyer = etat.foyerDe(LUI);
    expect(avec.photoPath).toMatch(new RegExp(`^signe://${foyer}/${t.id}-\\d+\\.jpg$`));
    expect(etat.fichiers.size).toBe(1);
    const remplacee = await post(`/api/transactions/${t.id}/photo`, formulaire({ photo: new Blob([jpeg]) }));
    expect(remplacee.photoPath).not.toBe(avec.photoPath);
    expect(etat.fichiers.size).toBe(1); // l'ancienne est supprimée
    commeUtilisateur(INCONNU);
    await expect(post(`/api/transactions/${t.id}/photo`, formulaire({ photo: new Blob([jpeg]) }))).rejects.toThrow(/Introuvable/);
    commeUtilisateur(LUI);
    expect((await del(`/api/transactions/${t.id}/photo`)).photoPath).toBeNull();
    expect(etat.fichiers.size).toBe(0);
  });

  it("importe un relevé : correspondance, doublons, règles, classement de la banque, annulation", async () => {
    const csv = [
      "Date;Libellé;Montant;Catégorie;Sous-catégorie",
      `${todayIso().split("-").reverse().join("/")};CB CARREFOUR;-45,50;;`, // doublon de la saisie existante
      `${addDays(todayIso(), -1).split("-").reverse().join("/")};PIZZERIA DU PORT;-18,00;;`, // règle « pizzeria »
      `${addDays(todayIso(), -2).split("-").reverse().join("/")};ENGIE FACTURE;-60,00;Logement;Electricité`, // banque
      `${addDays(todayIso(), -3).split("-").reverse().join("/")};MYSTERE SARL;-12,00;;`, // rien : catégorie par défaut
      `${addDays(todayIso(), -3).split("-").reverse().join("/")};VIREMENT EMPLOYEUR;1500,00;;`,
      "pas une date;x;1;;",
    ].join("\r\n");
    const apercu = await post("/api/import/preview", formulaire({ file: new Blob([csv]), walletId: String(ids["Compte courant"]), bank: "Ma Banque" }));
    expect(apercu.mapping).toMatchObject({ date: 0, label: 1, amount: 2, category: 3, subCategory: 4, dateFormat: "dmy" });
    expect(apercu.rows.map((r: Json) => [r.duplicate, r.categorySource, r.error])).toEqual([
      [true, "rule", null], [false, "rule", null], [false, "bank", null], [false, "ai", null], [false, "ai", null], [false, null, "Date illisible"],
    ]);
    const lot = await post("/api/import/commit", {
      bank: "Ma Banque", walletId: ids["Compte courant"], mapping: apercu.mapping, csv: apercu.csv, fileName: "releve.csv", skipDuplicates: true, autoConfirmKnown: true,
    });
    expect(lot).toMatchObject({ createdCount: 4, skippedCount: 2, remaining: 4, walletName: "Compte courant", fileName: "releve.csv" });
    const importees = await get("/api/transactions?q=") as unknown as Json[];
    const parLibelle = Object.fromEntries(importees.filter((t) => t.importId === lot.id).map((t) => [t.label, [t.categoryName, t.status]]));
    expect(parLibelle).toEqual({
      "PIZZERIA DU PORT": ["Restaurant", "confirmed"],
      "ENGIE FACTURE": ["Électricité et gaz", "to_verify"],
      "MYSTERE SARL": ["Divers", "to_verify"],
      "VIREMENT EMPLOYEUR": ["Autres revenus", "to_verify"],
    });
    const second = await post("/api/import/preview", formulaire({ file: new Blob([csv]), walletId: String(ids["Compte courant"]), bank: "ma banque" }));
    expect(second.savedMapping).toBe(true);
    expect(second.banks).toEqual(["ma banque"]);
    expect(second.rows.filter((r: Json) => r.duplicate)).toHaveLength(5);
    expect(await del(`/api/imports/${lot.id}`)).toEqual({ deleted: 4 });
    expect(await get("/api/imports")).toHaveLength(0);
  });

  it("lit plus de 1 000 lignes par tranches", async () => {
    psql(`insert into public.transactions (foyer_id, type, amount, date, wallet_id, category_id, label, status)
          select (select foyer_id from public.membres where user_id = '${LUI}'), 'expense', 100, current_date - (g % 300), ${ids["Compte courant"]}, ${ids["Supermarché"]}, 'lot ' || g, 'to_verify'
          from generate_series(1, 1500) g`);
    expect((await get("/api/transactions/to-verify-count")).count).toBe(1500);
    expect(await get("/api/transactions?status=to_verify")).toHaveLength(1500);
    expect(await get("/api/transactions?status=to_verify&limit=1200")).toHaveLength(1200);
    const toutes = (await get("/api/transactions?status=to_verify") as unknown as Json[]).map((t) => t.id);
    expect((await post("/api/transactions/bulk", { ids: toutes, action: "delete" })).done).toBe(1500);
    const csv = await get("/api/export.csv") as unknown as string;
    expect(csv.split("\n")[0]).toContain("saisi_par");
  });
});
