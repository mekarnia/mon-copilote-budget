import type { DB } from "../db.js";
import type { ChatMessage, Insight, WeeklyAdvice } from "../../shared/types.js";
import { isoWeek, todayIso } from "../../shared/dates.js";
import { AiNotConfigured, getClient } from "./ai.js";
import { computeInsights, contextSummary } from "./insights.js";

const MODEL = "claude-opus-5";

const TONE = `Tu es le coach budget d'une famille française. Ton : bienveillant, concret, sans jugement ni morale, tutoiement.
Tu parles uniquement à partir des chiffres fournis ; si une information manque, dis-le simplement. Tu ne donnes pas de conseil financier réglementé (placements, crédit).
Montants en euros avec le format français (1 234,56 €).`;

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
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 600,
    output_config: { effort: "low" },
    system: TONE,
    messages: [
      {
        role: "user",
        content: `Voici les constats de la semaine, déjà calculés (ne pas en inventer d'autres) :\n${JSON.stringify(insights, null, 1)}\n\nÉcris le conseil de la semaine en 3 phrases maximum, en français : un constat principal, une action simple, un encouragement. Pas de titre, pas de liste, pas d'emoji. Si la liste est vide, dis que la semaine est calme.`,
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new Error("Réponse IA indisponible");
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
}

export async function chat(db: DB, userMessage: string, today = todayIso()): Promise<ChatMessage> {
  const client = getClient(db); // lève AiNotConfigured avant d'enregistrer quoi que ce soit
  const history = listMessages(db, 10);
  db.prepare("INSERT INTO chat_messages (role, content) VALUES ('user', ?)").run(userMessage);
  const context = contextSummary(db, today);
  const insights = computeInsights(db, today);
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 800,
    output_config: { effort: "low" },
    system: [
      { type: "text", text: TONE },
      { type: "text", text: `Réponds en 2 phrases maximum, avec au moins un chiffre précis tiré des données. Si la question demande une décision (« je peux me permettre… »), réponds oui ou non d'abord, puis le chiffre qui le justifie (reste à dépenser, budget restant, marge du mois dernier). Ne propose pas d'action que l'application ne permet pas : elle permet de créer un budget, un projet, une récurrence, ou un virement interne.` },
      { type: "text", text: `Données de l'utilisateur (montants en euros) :\n${JSON.stringify(context)}\n\nConstats de la semaine :\n${JSON.stringify(insights)}` },
    ],
    messages: [...history.map((m) => ({ role: m.role, content: m.content })), { role: "user" as const, content: userMessage }],
  });
  if (response.stop_reason === "refusal") throw new Error("Je ne peux pas répondre à cette question.");
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim() || "Je n'ai pas de réponse pour cette question.";
  const res = db.prepare("INSERT INTO chat_messages (role, content) VALUES ('assistant', ?)").run(text);
  return mapMsg(db.prepare("SELECT * FROM chat_messages WHERE id = ?").get(Number(res.lastInsertRowid)) as unknown as MsgRow);
}

export { AiNotConfigured };
