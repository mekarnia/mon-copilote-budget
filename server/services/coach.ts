import type { DB } from "../db.js";
import type { ChatMessage, Insight, WeeklyAdvice } from "../../shared/types.js";
import { isoWeek, todayIso } from "../../shared/dates.js";
import { AiNotConfigured, CHAT_MODEL, FAST_MODEL, MODEL, getClient } from "./ai.js";
import { computeInsights } from "./insights.js";
import { financialBriefing } from "./briefing.js";
import { mesurer } from "./aiUsage.js";
import { DONNEES_NON_FIABLES, texteSur } from "./securite.js";
import { suggestBudgets, type BudgetSuggestion } from "./budgets.js";
import { avoidableStats, type AvoidableGoal, type PeriodKey } from "./periods.js";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const MEMO_MODEL = FAST_MODEL;

/** Messages envoyés tels quels ; au-delà, ils passent dans la mémoire résumée. */
const HISTORY_KEPT = 6;
/** Nombre de messages accumulés avant de rafraîchir la mémoire. */
const MEMORY_EVERY = 12;
const MEMORY_KEY = "chatMemory";
const MEMORY_MAX = 700;

const TONE = `Tu es le coach budget d'une famille française. Ton : bienveillant, concret, sans jugement ni morale, tutoiement.
Tu parles uniquement à partir des chiffres fournis ; si une information manque, dis-le simplement. Tu ne donnes pas de conseil financier réglementé (placements, crédit).
Montants en dinars algériens avec le format « 1 234,56 DA ».`;

/**
 * Règles du chat. Volontairement sèches : chaque phrase supprimée ici est payée
 * à chaque question, et chaque contrainte de brièveté est payée en jetons de sortie.
 */
const CHAT_RULES = `Tu conseilles une famille sur son argent. Deux casquettes en même temps : analyste financier rigoureux, et père de famille qui sait ce que coûte le quotidien.

RÉPONSE
- 3 phrases maximum. Aucune liste, aucun titre, aucun préambule, aucun emoji.
- Toujours au moins un chiffre exact venant du briefing.
- Question de décision (« je peux me permettre… ») : oui ou non en premier mot, puis le chiffre qui le justifie.
- Donnée absente : dis-le en une phrase. N'invente aucun chiffre.

ANALYSE, dans cet ordre
1. Capacité d'épargne : entrées moins sorties du mois, et sa tendance sur trois mois.
2. Fuite : la catégorie qui dérive le plus vite, pas la plus grosse.
3. Effet à un an : toute économie mensuelle, traduis-la en montant annuel.
4. Affectation : d'abord une réserve de trois à six mois de dépenses, ensuite les projets déclarés, ensuite seulement l'investissement.

LIMITES
- Tu parles de l'argent de cette famille, pas des marchés. Taux d'épargne, réserve de sécurité, ordre de remboursement d'une dette, coût d'opportunité d'un achat : oui.
- Aucun produit financier nommé, aucun placement précis, aucun crédit recommandé. Si on te le demande, une phrase pour dire que c'est hors de ton rôle, puis ramène à la capacité d'épargne.
- Ne propose que ce que l'application sait faire : créer un budget, un projet, une récurrence, un virement interne.

Montants en dinars algériens, format « 1 234,56 DA ».`;

/** Message de repli quand il n'y a pas de clé IA : les faits, sans fioriture. */
export function templateMessage(insights: Insight[]): string {
  if (insights.length === 0) return "Semaine calme : rien d'inhabituel, les budgets tiennent. Continuez à saisir vos dépenses au fil de l'eau.";
  const first = insights[0];
  const good = insights.filter((i) => i.severity === "good").length;
  const lead = first.severity === "good" ? "Bonne semaine : " : "Cette semaine, un point à surveiller : ";
  let msg = `${lead}${first.title.toLowerCase()}.`;
  if (insights.length > 1) msg += ` ${insights.length - 1} autre${insights.length > 2 ? "s" : ""} constat${insights.length > 2 ? "s" : ""} ci-dessous${good > 0 && first.severity !== "good" ? ", dont une bonne nouvelle" : ""}.`;
  return msg;
}

async function aiMessage(db: DB, insights: Insight[]): Promise<string> {
  const client = getClient(db);
  const response = await mesurer(db, "Conseil de la semaine", () => client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "low" },
    system: `${TONE}\n${DONNEES_NON_FIABLES}`,
    messages: [
      {
        role: "user",
        content: `Voici les constats de la semaine, déjà calculés (ne pas en inventer d'autres) :\n${JSON.stringify(insights, null, 1)}\n\nÉcris le conseil de la semaine en 3 phrases maximum, en français : un constat principal, une action simple, un encouragement. Pas de titre, pas de liste, pas d'emoji. Si la liste est vide, dis que la semaine est calme.`,
      },
    ],
  }));
  if (response.stop_reason === "refusal") throw new Error("Réponse IA indisponible");
  if (response.stop_reason === "max_tokens") throw new Error("Réponse IA coupée avant la fin");
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  if (!text) throw new Error("Réponse IA vide");
  return text;
}

interface AdviceRow { week: string; message: string; insights: string; generated_by: "ai" | "template"; created_at: string }
const mapAdvice = (r: AdviceRow): WeeklyAdvice => ({ week: r.week, message: r.message, insights: JSON.parse(r.insights) as Insight[], generatedBy: r.generated_by, createdAt: r.created_at });

/** Conseil de la semaine : calculé une fois par semaine ISO, régénérable à la demande. */
export async function weeklyAdvice(db: DB, opts: { force?: boolean; today?: string } = {}): Promise<WeeklyAdvice> {
  const today = opts.today ?? todayIso();
  const week = isoWeek(today);
  if (!opts.force) {
    const cached = db.prepare("SELECT * FROM weekly_advice WHERE week = ?").get(week) as unknown as AdviceRow | undefined;
    if (cached) return mapAdvice(cached);
  }
  const insights = computeInsights(db, today);
  let message: string, generatedBy: "ai" | "template";
  try {
    message = await aiMessage(db, insights);
    generatedBy = "ai";
  } catch {
    message = templateMessage(insights);
    generatedBy = "template";
  }
  db.prepare(`INSERT INTO weekly_advice (week, message, insights, generated_by) VALUES (?, ?, ?, ?)
    ON CONFLICT(week) DO UPDATE SET message = excluded.message, insights = excluded.insights, generated_by = excluded.generated_by, created_at = datetime('now')`)
    .run(week, message, JSON.stringify(insights), generatedBy);
  return mapAdvice(db.prepare("SELECT * FROM weekly_advice WHERE week = ?").get(week) as unknown as AdviceRow);
}

// ---------- Chat ----------

interface MsgRow { id: number; role: "user" | "assistant"; content: string; created_at: string }
const mapMsg = (r: MsgRow): ChatMessage => ({ id: r.id, role: r.role, content: r.content, createdAt: r.created_at });

export function listMessages(db: DB, limit = 50): ChatMessage[] {
  const rows = db.prepare("SELECT * FROM chat_messages ORDER BY id DESC LIMIT ?").all(limit) as unknown as MsgRow[];
  return rows.reverse().map(mapMsg);
}

export function clearMessages(db: DB): void {
  db.exec("DELETE FROM chat_messages");
  db.prepare("DELETE FROM settings WHERE key = ?").run(MEMORY_KEY);
}

interface Memory { text: string; upTo: number }

function readMemory(db: DB): Memory {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(MEMORY_KEY) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as Memory) : { text: "", upTo: 0 };
}

/**
 * Mémoire longue : les anciens messages sont condensés en quelques lignes plutôt
 * que renvoyés intégralement à chaque question. Le coach se souvient sans payer
 * l'historique complet à chaque fois.
 */
async function refreshMemory(db: DB): Promise<void> {
  const memory = readMemory(db);
  const cutoff = (db.prepare(`SELECT id FROM chat_messages ORDER BY id DESC LIMIT 1 OFFSET ?`).get(HISTORY_KEPT) as { id: number } | undefined)?.id;
  if (cutoff === undefined || cutoff <= memory.upTo) return;
  const fresh = db.prepare("SELECT * FROM chat_messages WHERE id > ? AND id <= ? ORDER BY id").all(memory.upTo, cutoff) as unknown as MsgRow[];
  if (fresh.length < MEMORY_EVERY) return;
  const client = getClient(db);
  const response = await mesurer(db, "Mémoire du coach", () => client.messages.create({
    model: MEMO_MODEL,
    max_tokens: 1000,
    system: `Tu tiens la mémoire d'un coach budget familial. Condense en ${MEMORY_MAX} caractères maximum, en français, sans titre ni liste : les objectifs annoncés par la famille, les décisions prises, les contraintes et préférences durables, les sujets déjà traités. Garde les chiffres seulement s'ils restent vrais dans le temps (un objectif, un loyer), jamais un solde du moment. Supprime tout le reste.`,
    messages: [{ role: "user", content: `Mémoire actuelle :\n${memory.text || "(vide)"}\n\nNouveaux échanges à intégrer :\n${fresh.map((m) => `${m.role === "user" ? "Q" : "R"}: ${m.content}`).join("\n")}` }],
  }));
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim().slice(0, MEMORY_MAX);
  if (!text) return;
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(MEMORY_KEY, JSON.stringify({ text, upTo: cutoff } satisfies Memory));
}

export interface ChatOptions {
  today?: string;
  /** Appelé à chaque morceau de texte, pour l'afficher pendant que le modèle écrit. */
  onDelta?: (morceau: string) => void;
}

export async function chat(db: DB, userMessage: string, options: ChatOptions = {}): Promise<ChatMessage> {
  const today = options.today ?? todayIso();
  const client = getClient(db); // lève AiNotConfigured avant d'enregistrer quoi que ce soit
  // Une question restée sans réponse laisse un message utilisateur orphelin :
  // la fenêtre pourrait alors commencer par une réponse, ce que l'API refuse.
  const history = listMessages(db, HISTORY_KEPT);
  while (history.length > 0 && history[0].role === "assistant") history.shift();
  db.prepare("INSERT INTO chat_messages (role, content) VALUES ('user', ?)").run(userMessage);
  const memory = readMemory(db);
  const requete = {
    max_tokens: 16000,
    output_config: { effort: "low" as const },
    system: [
      { type: "text" as const, text: CHAT_RULES },
      ...(memory.text ? [{ type: "text" as const, text: `Ce que tu sais déjà de cette famille :\n${memory.text}` }] : []),
      { type: "text" as const, text: `Briefing chiffré :\n${financialBriefing(db, today)}` },
    ],
    messages: [...history.map((m) => ({ role: m.role, content: m.content })), { role: "user" as const, content: userMessage }],
  };
  // La réponse arrive par morceaux : trois phrases mettent plusieurs secondes à
  // venir, et regarder un écran vide les fait paraître bien plus longues.
  let ecrit = false;
  const demander = (model: string) =>
    mesurer(db, "Chat du coach", async () => {
      const flux = client.messages.stream({ model, ...requete });
      if (options.onDelta) {
        flux.on("text", (morceau) => {
          ecrit = true;
          options.onDelta!(morceau);
        });
      }
      return flux.finalMessage();
    });

  // Tous les comptes n'ont pas accès aux mêmes modèles. Le chat vise le moins
  // cher, et retombe sur celui des autres fonctions si le compte ne l'a pas :
  // mieux vaut une réponse plus chère qu'un coach en panne.
  let response;
  try {
    response = await demander(CHAT_MODEL);
  } catch (e) {
    const statut = (e as { status?: number }).status;
    // Un échec survenu après les premiers mots : réessayer les afficherait deux fois.
    if ((statut !== 403 && statut !== 404) || ecrit) throw e;
    console.warn(`Modèle ${CHAT_MODEL} inaccessible (${statut}) : le chat passe sur ${MODEL}.`);
    response = await demander(MODEL);
  }
  if (response.stop_reason === "refusal") throw new Error("Je ne peux pas répondre à cette question.");
  if (response.stop_reason === "max_tokens") throw new Error("La réponse a été coupée avant la fin. Reformulez plus court.");
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim() || "Je n'ai pas de réponse pour cette question.";
  const res = db.prepare("INSERT INTO chat_messages (role, content) VALUES ('assistant', ?)").run(text);
  // La mémoire se met à jour en arrière-plan : elle ne doit jamais retarder ni faire échouer la réponse.
  void refreshMemory(db).catch(() => undefined);
  return mapMsg(db.prepare("SELECT * FROM chat_messages WHERE id = ?").get(Number(res.lastInsertRowid)) as unknown as MsgRow);
}

export { AiNotConfigured };

// ---------- Budgets du mois prochain ----------

const budgetSchema = z.object({
  items: z.array(z.object({ category_id: z.number().int(), suggested_da: z.number(), reason: z.string() })),
});

/** Suggestions pour `month` : calcul déterministe, affiné par l'IA quand une clé est présente. */
export async function suggestedBudgets(db: DB, month: string): Promise<{ items: BudgetSuggestion[]; generatedBy: "ai" | "template" }> {
  const base = suggestBudgets(db, month);
  if (base.length === 0) return { items: base, generatedBy: "template" };
  try {
    const client = getClient(db);
    const response = await mesurer(db, "Budgets suggérés", () => client.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "low", format: zodOutputFormat(budgetSchema) },
      system: `${TONE}\nTu proposes les budgets mensuels d'une famille pour le mois ${month}, catégorie par catégorie, à partir des dépenses réelles. Reste proche des montants calculés (écart maximal 20 %), arrondis à la centaine de dinars, et justifie chaque montant en une phrase courte qui cite un chiffre. Ne crée pas de catégorie.`,
      messages: [{ role: "user", content: JSON.stringify(base.map((b) => ({ category_id: b.categoryId, name: b.categoryName, previous_budget_da: b.previousBudget / 100, last_month_spent_da: b.lastSpent / 100, average_3_months_da: b.average3 / 100, saved_last_month_da: b.saved / 100, computed_suggestion_da: b.suggested / 100 }))) }],
    }));
    const parsed = response.parsed_output;
    if (!parsed) return { items: base, generatedBy: "template" };
    const byId = new Map(parsed.items.map((i) => [i.category_id, i]));
    const items = base.map((b) => {
      const ai = byId.get(b.categoryId);
      if (!ai || !(ai.suggested_da > 0)) return b;
      const cents = Math.round(ai.suggested_da * 100);
      const bounded = Math.min(Math.round(b.suggested * 1.2), Math.max(Math.round(b.suggested * 0.8), cents));
      return { ...b, suggested: Math.ceil(bounded / 10000) * 10000, reason: ai.reason.trim() || b.reason };
    });
    return { items, generatedBy: "ai" };
  } catch {
    return { items: base, generatedBy: "template" };
  }
}

// ---------- Objectif sur les dépenses évitables ----------

const goalSchema = z.object({
  target_da: z.number(),
  reason: z.string(),
  actions: z.array(z.string()).max(3),
});

/** Objectif rédigé par l'IA pour les dépenses évitables ; renvoie l'objectif calculé si pas de clé ou en cas d'échec. Cache par jour et par montant. */
export async function avoidableAiGoal(db: DB, period: PeriodKey, today = todayIso()): Promise<AvoidableGoal | null> {
  const stats = avoidableStats(db, period, today);
  if (!stats.goal || stats.total <= 0) return null;
  const cacheKey = `goal:${period}`;
  const cached = db.prepare("SELECT value FROM settings WHERE key = ?").get(cacheKey) as { value: string } | undefined;
  if (cached) {
    const c = JSON.parse(cached.value) as { date: string; total: number; goal: AvoidableGoal };
    if (c.date === today && c.total === stats.total) return c.goal;
  }
  const calcule: AvoidableGoal = stats.goal;
  let goal: AvoidableGoal = calcule;
  try {
    const client = getClient(db);
    const response = await mesurer(db, "Objectif du coach", () => client.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "low", format: zodOutputFormat(goalSchema) },
      system: `${TONE}\nTu fixes un objectif de réduction des dépenses évitables pour la prochaine période, à partir des chiffres fournis. Règles : la cible est entre 50 % et 95 % du total actuel, arrondie à la centaine de dinars ; la raison tient en une phrase et cite un chiffre ; les actions (2 ou 3) sont concrètes et s'appuient sur les libellés et catégories fournis, jamais inventés ; pas de morale.\n${DONNEES_NON_FIABLES}`,
      messages: [{
        role: "user",
        content: JSON.stringify({
          period, total_da: stats.total / 100, previous_total_da: stats.previousTotal / 100, share_of_all_expenses: Math.round(stats.shareOfExpenses * 100),
          computed_target_da: calcule.target / 100, project: calcule.projectName,
          by_category: stats.byCategory.map((c) => ({ name: texteSur(c.name, 40), total_da: c.total / 100, share: Math.round(c.share * 100) })),
          // Ces libellés viennent des relevés de banque, donc des commerçants :
          // ils entrent dans la consigne comme données, jamais comme instructions.
          frequent_labels: stats.topLabels.map((l) => ({ label: texteSur(l.label), count: l.count, total_da: l.total / 100, category: texteSur(l.categoryName ?? "", 40) })),
        }),
      }],
    }, { timeout: 60_000, maxRetries: 0 }));
    const p = response.parsed_output;
    if (p && p.target_da > 0) {
      const cents = Math.round(p.target_da * 100);
      const bounded = Math.min(Math.round(stats.total * 0.95), Math.max(Math.round(stats.total * 0.5), cents));
      const target = Math.floor(bounded / 10000) * 10000;
      if (target > 0 && target < stats.total) {
        goal = { target, saving: stats.total - target, projectName: calcule.projectName, reason: p.reason.trim() || calcule.reason, actions: p.actions.map((a) => a.trim()).filter(Boolean).slice(0, 3), generatedBy: "ai" };
      }
    }
  } catch {
    /* clé absente, refusée ou trop lente : objectif calculé */
  }
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(cacheKey, JSON.stringify({ date: today, total: stats.total, goal }));
  return goal;
}

export { avoidableStats };
