import { z } from "zod";

// Montants stockés en centimes (entiers) pour éviter les erreurs de flottants.
export const WALLET_TYPES = ["courant", "especes", "livret", "autre"] as const;
export type WalletType = (typeof WALLET_TYPES)[number];

export const TX_TYPES = ["expense", "income", "transfer"] as const;
export type TxType = (typeof TX_TYPES)[number];

export const CATEGORY_KINDS = ["expense", "income", "technical"] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

export const PAYMENT_METHODS = ["card", "cash"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_LABEL: Record<PaymentMethod, string> = { card: "Carte", cash: "Espèces" };

export const FREQUENCIES = ["monthly", "weekly"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ");
const cents = z.number().int().positive("Le montant doit être positif");

export const walletInput = z.object({
  name: z.string().trim().min(1).max(60),
  type: z.enum(WALLET_TYPES),
  initialBalance: z.number().int().default(0),
});
export type WalletInput = z.infer<typeof walletInput>;

export interface Wallet extends WalletInput {
  id: number;
  balance: number;
  archived: boolean;
}

export const adjustInput = z.object({
  realBalance: z.number().int(),
  date: isoDate.optional(),
});

export const categoryInput = z.object({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(CATEGORY_KINDS).default("expense"),
  parentId: z.number().int().nullable().default(null),
  icon: z.string().max(4).nullable().default(null),
});
export type CategoryInput = z.infer<typeof categoryInput>;

export interface Category extends CategoryInput {
  id: number;
  sort: number;
  technicalKey: string | null;
}

export const transactionInput = z
  .object({
    type: z.enum(TX_TYPES),
    amount: cents,
    date: isoDate,
    walletId: z.number().int(),
    toWalletId: z.number().int().nullable().default(null),
    categoryId: z.number().int().nullable().default(null),
    projectId: z.number().int().nullable().default(null),
    label: z.string().trim().max(120).default(""),
    note: z.string().trim().max(500).default(""),
    paymentMethod: z.enum(PAYMENT_METHODS).nullable().optional(),
    time: z.string().regex(/^\d{2}:\d{2}$/, "Heure attendue au format HH:MM").nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === "transfer") {
      if (!v.toWalletId) ctx.addIssue({ code: "custom", path: ["toWalletId"], message: "Portefeuille de destination requis" });
      if (v.toWalletId === v.walletId) ctx.addIssue({ code: "custom", path: ["toWalletId"], message: "Les deux portefeuilles doivent être différents" });
    } else if (!v.categoryId) {
      ctx.addIssue({ code: "custom", path: ["categoryId"], message: "Catégorie requise" });
    }
  });
export type TransactionInput = z.infer<typeof transactionInput>;

export const TX_STATUSES = ["confirmed", "to_verify"] as const;
export type TxStatus = (typeof TX_STATUSES)[number];

export interface Transaction extends TransactionInput {
  id: number;
  status: TxStatus;
  importId: number | null;
  photoPath: string | null;
  recurrenceId: number | null;
  technical: boolean;
  categoryName: string | null;
  walletName: string;
  toWalletName: string | null;
}

export const recurrenceInput = z
  .object({
    label: z.string().trim().min(1).max(120),
    type: z.enum(TX_TYPES),
    amount: cents,
    frequency: z.enum(FREQUENCIES),
    day: z.number().int().min(0).max(31),
    walletId: z.number().int(),
    toWalletId: z.number().int().nullable().default(null),
    categoryId: z.number().int().nullable().default(null),
    startDate: isoDate.optional(),
    active: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.frequency === "monthly" && (v.day < 1 || v.day > 31))
      ctx.addIssue({ code: "custom", path: ["day"], message: "Jour du mois entre 1 et 31" });
    if (v.frequency === "weekly" && v.day > 6)
      ctx.addIssue({ code: "custom", path: ["day"], message: "Jour de la semaine entre 0 (dimanche) et 6" });
    if (v.type === "transfer" && !v.toWalletId)
      ctx.addIssue({ code: "custom", path: ["toWalletId"], message: "Portefeuille de destination requis" });
    if (v.type !== "transfer" && !v.categoryId)
      ctx.addIssue({ code: "custom", path: ["categoryId"], message: "Catégorie requise" });
  });
export type RecurrenceInput = z.infer<typeof recurrenceInput>;

export interface Recurrence extends RecurrenceInput {
  id: number;
  nextDate: string;
  categoryName: string | null;
  walletName: string;
}

export const budgetInput = z.object({
  categoryId: z.number().int(),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  amount: z.number().int().min(0),
});
export const budgetCopyInput = z.object({ from: z.string().regex(/^\d{4}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}$/) });
export const budgetApplyInput = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  items: z.array(z.object({ categoryId: z.number().int(), amount: z.number().int().min(0) })).max(50),
});
export type BudgetInput = z.infer<typeof budgetInput>;

export interface BudgetLine {
  categoryId: number;
  categoryName: string;
  icon: string | null;
  amount: number;
  spent: number;
  ratio: number;
  status: "green" | "orange" | "red" | "none";
}

export const projectInput = z.object({
  name: z.string().trim().min(1).max(80),
  target: cents,
  dueDate: isoDate.nullable().default(null),
  walletId: z.number().int(),
});
export type ProjectInput = z.infer<typeof projectInput>;

export interface Project extends ProjectInput {
  id: number;
  saved: number;
  remaining: number;
  ratio: number;
  monthlyNeeded: number | null;
  done: boolean;
  walletName: string;
}

export const contributeInput = z.object({
  amount: cents,
  fromWalletId: z.number().int(),
  date: isoDate.optional(),
});

export interface UpcomingBill {
  recurrenceId: number;
  label: string;
  amount: number;
  date: string;
  type: TxType;
}

export interface CategoryTotal {
  categoryId: number;
  name: string;
  icon: string | null;
  total: number;
}

export interface HomeSummary {
  month: string;
  income: number;
  expense: number;
  upcomingExpense: number;
  remaining: number;
  byCategory: CategoryTotal[];
  upcoming: UpcomingBill[];
  redBudgets: BudgetLine[];
  projects: Project[];
  walletsTotal: number;
}

export interface LabelSuggestion {
  label: string;
  categoryId: number | null;
  walletId: number;
  type: TxType;
  paymentMethod: PaymentMethod | null;
}

// ---- MVC 2 : saisie sans effort ----

/** Brouillon renvoyé par l'IA (photo ou voix), à confirmer par l'utilisateur. */
export interface TransactionDraft {
  type: TxType | null;
  paymentMethod: PaymentMethod | null;
  amount: number | null;
  date: string | null;
  label: string;
  categoryId: number | null;
  walletId: number | null;
  toWalletId: number | null;
  question: string | null;
  source: "photo" | "voice";
}

export const parseTextInput = z.object({ text: z.string().trim().min(1).max(500) });

export interface CategorySuggestion {
  categoryId: number | null;
  walletId: number | null;
  source: "rule" | "ai" | "none";
}

export interface ImportColumnMapping {
  date: number;
  label: number;
  amount: number | null;
  debit: number | null;
  credit: number | null;
  dateFormat: "dmy" | "ymd" | "mdy";
}

export interface ImportPreviewRow {
  date: string | null;
  label: string;
  amount: number | null;
  type: TxType | null;
  duplicate: boolean;
  error: string | null;
}

export interface ImportPreview {
  columns: string[];
  sample: string[][];
  mapping: ImportColumnMapping;
  savedMapping: boolean;
  rows: ImportPreviewRow[];
}

export const importCommitInput = z.object({
  bank: z.string().trim().min(1).max(60),
  walletId: z.number().int(),
  mapping: z.object({
    date: z.number().int(),
    label: z.number().int(),
    amount: z.number().int().nullable(),
    debit: z.number().int().nullable(),
    credit: z.number().int().nullable(),
    dateFormat: z.enum(["dmy", "ymd", "mdy"]),
  }),
  csv: z.string().min(1),
  fileName: z.string().max(200).default(""),
  skipDuplicates: z.boolean().default(true),
});
export type ImportCommitInput = z.infer<typeof importCommitInput>;

export interface ImportBatch {
  id: number;
  bank: string;
  walletId: number;
  walletName: string;
  fileName: string;
  createdCount: number;
  skippedCount: number;
  createdAt: string;
  remaining: number;
}

// ---- MVC 3 : coach ----

export type InsightKind = "budget_drift" | "unusual_expense" | "undeclared_recurrence" | "low_balance" | "project_progress" | "budget_kept" | "savings";

export interface Insight {
  kind: InsightKind;
  severity: "info" | "warning" | "good";
  title: string;
  text: string;
  amount: number | null;
  link: string | null;
}

export interface WeeklyAdvice {
  week: string;
  message: string;
  insights: Insight[];
  generatedBy: "ai" | "template";
  createdAt: string;
}

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export const chatInput = z.object({ message: z.string().trim().min(1).max(1000) });

/** Une habitude de l'utilisateur : libellé récurrent avec son montant type et son contexte habituel. */
export interface HabitSuggestion {
  label: string;
  count: number;
  typicalAmount: number;
  lastDate: string;
  categoryId: number | null;
  walletId: number;
  paymentMethod: PaymentMethod | null;
  score: number;
}
