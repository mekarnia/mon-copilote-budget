import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { DB } from "../db.js";
import type { Category, TransactionDraft, Wallet } from "../../shared/types.js";
import { todayIso } from "../../shared/dates.js";
import { listCategories } from "./categories.js";
import { listWallets } from "./wallets.js";

const MODEL = "claude-opus-5";

export class AiNotConfigured extends Error {
  constructor() {
    super("Ajoutez votre clé IA dans Réglages → Sauvegarde et clé IA pour utiliser la photo, la dictée et le coach.");
  }
}

export function getClient(db: DB): Anthropic {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'aiKey'").get() as { value: string } | undefined;
  if (!row?.value) throw new AiNotConfigured();
  if (!/^sk-ant-[A-Za-z0-9_\-]{20,}$/.test(row.value)) throw new Error("La clé IA enregistrée est invalide. Recollez-la dans Réglages, elle commence par sk-ant-.");
  return new Anthropic({ apiKey: row.value });
}

const draftSchema = z.object({
  type: z.enum(["expense", "income", "transfer"]).nullable(),
  amount_euros: z.number().nullable(),
  date: z.string().nullable(),
  label: z.string(),
  category_id: z.number().int().nullable(),
  wallet_id: z.number().int().nullable(),
  to_wallet_id: z.number().int().nullable(),
  payment_method: z.enum(["card", "cash"]).nullable(),
  question: z.string().nullable(),
});

function catalogue(categories: Category[], wallets: Wallet[]): string {
  const parents = categories.filter((c) => !c.parentId && !c.technicalKey);
  const cats = parents
    .map((p) => {
      const children = categories.filter((c) => c.parentId === p.id).map((c) => `    - ${c.id} : ${c.name}`).join("\n");
      return `  - ${p.id} : ${p.name} (${p.kind === "income" ? "revenu" : "dépense"})\n${children}`;
    })
    .join("\n");
  const ws = wallets.map((w) => `  - ${w.id} : ${w.name} (${w.type})`).join("\n");
  return `Catégories disponibles (utiliser l'identifiant numérique, préférer une sous-catégorie) :\n${cats}\n\nPortefeuilles disponibles :\n${ws}`;
}

function system(db: DB, today: string): string {
  return `Tu extrais une opération financière pour une application de budget familial française.
Aujourd'hui : ${today} (format AAAA-MM-JJ). Résous les dates relatives (hier, ce matin, lundi dernier, le 5) par rapport à cette date. Si aucune date n'est mentionnée, mets la date du jour.
Le montant est en euros, positif. Le type est "expense" (dépense), "income" (revenu) ou "transfer" (virement entre deux portefeuilles).
Le libellé est court : le nom du commerçant ou l'objet de l'opération, sans montant ni date.
Le moyen de paiement est "cash" si la phrase parle d'espèces, de liquide ou de cash, "card" si elle parle de carte ou CB, sinon null. Pour un paiement en espèces, choisis le portefeuille de type "especes" s'il existe.
Si un élément essentiel est réellement ambigu (montant illisible, catégorie impossible à deviner), pose une seule question courte en français dans "question", sinon mets null.
Ne pose pas de question pour un choix raisonnable : choisis la sous-catégorie la plus probable.
${catalogue(listCategories(db), listWallets(db))}`;
}

function toDraft(p: z.infer<typeof draftSchema>, source: TransactionDraft["source"]): TransactionDraft {
  const date = p.date && /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : null;
  return {
    type: p.type,
    amount: p.amount_euros !== null && p.amount_euros > 0 ? Math.round(p.amount_euros * 100) : null,
    date,
    label: p.label.trim().slice(0, 120),
    categoryId: p.category_id,
    walletId: p.wallet_id,
    toWalletId: p.to_wallet_id,
    paymentMethod: p.payment_method,
    question: p.question?.trim() || null,
    source,
  };
}

/** Photo de ticket -> brouillon d'opération. */
export async function extractReceipt(db: DB, image: Buffer, mediaType: "image/jpeg" | "image/png" | "image/webp", today = todayIso()): Promise<TransactionDraft> {
  const client = getClient(db);
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 2000,
    system: system(db, today),
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: image.toString("base64") } },
          { type: "text", text: "Voici la photo d'un ticket ou d'une facture. Extrais le montant total TTC payé, la date du ticket, le nom du commerçant en libellé, et propose la catégorie. C'est une dépense sauf mention explicite contraire." },
        ],
      },
    ],
    output_config: { format: zodOutputFormat(draftSchema) },
  });
  if (!response.parsed_output) throw new Error("Lecture du ticket impossible, réessayez avec une photo plus nette.");
  return toDraft(response.parsed_output, "photo");
}

/** Phrase dictée -> brouillon d'opération. */
export async function parseSpeech(db: DB, text: string, today = todayIso()): Promise<TransactionDraft> {
  const client = getClient(db);
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 1500,
    system: system(db, today),
    messages: [{ role: "user", content: `Phrase dictée : « ${text} »` }],
    output_config: { format: zodOutputFormat(draftSchema) },
  });
  if (!response.parsed_output) throw new Error("Je n'ai pas compris, reformulez en indiquant le montant.");
  return toDraft(response.parsed_output, "voice");
}

const categorySchema = z.object({ category_id: z.number().int().nullable() });

/** Catégorie proposée par l'IA pour un libellé, quand aucune règle ne correspond. */
export async function suggestCategory(db: DB, label: string): Promise<number | null> {
  const client = getClient(db);
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 500,
    output_config: { effort: "low", format: zodOutputFormat(categorySchema) },
    system: `Tu classes un libellé d'opération bancaire française dans une catégorie de budget. Réponds par l'identifiant de la sous-catégorie la plus probable, ou null si vraiment impossible.\n${catalogue(listCategories(db), [])}`,
    messages: [{ role: "user", content: `Libellé : « ${label} »` }],
  });
  return response.parsed_output?.category_id ?? null;
}
