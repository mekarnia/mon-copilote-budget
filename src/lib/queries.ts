import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type {
  BudgetLine, Category, CategoryInput, CategorySuggestion, HomeSummary, ImportBatch, ImportColumnMapping, ImportCommitInput,
  ChatMessage, HabitSuggestion, ImportPreview, LabelSuggestion, Project, ProjectInput, Recurrence, RecurrenceInput, Transaction, TransactionDraft, WeeklyAdvice,
  TransactionInput, TxStatus, TxType, Wallet, WalletInput,
} from "@shared/types";

export const useWallets = (all = false) => useQuery({ queryKey: ["wallets", all], queryFn: () => api.get<Wallet[]>(`/api/wallets${all ? "?all=1" : ""}`) });
export const useCategories = () => useQuery({ queryKey: ["categories"], queryFn: () => api.get<Category[]>("/api/categories") });
export const useHome = (month: string) => useQuery({ queryKey: ["home", month], queryFn: () => api.get<HomeSummary>(`/api/home?month=${month}`) });
export const useTransactions = (month: string, q: string, status?: TxStatus, categoryId?: number | null) =>
  useQuery({
    queryKey: ["transactions", month, q, status ?? "", categoryId ?? 0],
    queryFn: () =>
      api.get<Transaction[]>(
        `/api/transactions?${status ? "" : `month=${month}&`}q=${encodeURIComponent(q)}${status ? `&status=${status}` : ""}${categoryId ? `&categoryId=${categoryId}` : ""}`,
      ),
  });
export interface CategoryContext {
  month: string | null;
  sub: { id: number; name: string; total: number; count: number } | null;
  parent: { id: number; name: string; icon: string | null; total: number; count: number } | null;
}
export const useCategoryContext = (categoryId: number | null, month: string, type: TxType) =>
  useQuery({
    queryKey: ["categoryContext", categoryId, month, type],
    queryFn: () => api.get<CategoryContext>(`/api/categories/${categoryId}/context?month=${month}&type=${type}`),
    enabled: categoryId !== null && type !== "transfer",
    placeholderData: (prev) => prev,
  });
export const useToVerifyCount = () => useQuery({ queryKey: ["toVerifyCount"], queryFn: () => api.get<{ count: number }>("/api/transactions/to-verify-count") });
export const useTransaction = (id: number | null) =>
  useQuery({ queryKey: ["transaction", id], queryFn: () => api.get<Transaction>(`/api/transactions/${id}`), enabled: id !== null });
export const useLabels = (q: string) =>
  useQuery({ queryKey: ["labels", q], queryFn: () => api.get<LabelSuggestion[]>(`/api/transactions/labels?q=${encodeURIComponent(q)}`), enabled: q.length >= 2 });
export const useBudgets = (month: string) => useQuery({ queryKey: ["budgets", month], queryFn: () => api.get<BudgetLine[]>(`/api/budgets?month=${month}`) });
export const useProjects = () => useQuery({ queryKey: ["projects"], queryFn: () => api.get<Project[]>("/api/projects") });
export const useRecurrences = () => useQuery({ queryKey: ["recurrences"], queryFn: () => api.get<Recurrence[]>("/api/recurrences") });
export const useSettings = () => useQuery({ queryKey: ["settings"], queryFn: () => api.get<Record<string, string>>("/api/settings") });

/** Toute écriture invalide l'ensemble : les données sont petites, la simplicité prime. */
export function useInvalidateAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}

function useWrite<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: fn, onSuccess: () => invalidate() });
}

export const useSaveTransaction = () =>
  useWrite(({ id, input }: { id?: number; input: TransactionInput }) =>
    id ? api.put<Transaction>(`/api/transactions/${id}`, input) : api.post<Transaction>("/api/transactions", input));
export const useDeleteTransaction = () => useWrite((id: number) => api.del(`/api/transactions/${id}`));
export const useUploadPhoto = () =>
  useWrite(({ id, file }: { id: number; file: File }) => {
    const form = new FormData();
    form.append("photo", file);
    return api.post<Transaction>(`/api/transactions/${id}/photo`, form);
  });
export const useRemovePhoto = () => useWrite((id: number) => api.del<Transaction>(`/api/transactions/${id}/photo`));

export const useSaveWallet = () =>
  useWrite(({ id, input }: { id?: number; input: WalletInput }) => (id ? api.put<Wallet>(`/api/wallets/${id}`, input) : api.post<Wallet>("/api/wallets", input)));
export const useRemoveWallet = () => useWrite((id: number) => api.del<{ result: string }>(`/api/wallets/${id}`));
export const useAdjustWallet = () => useWrite(({ id, realBalance }: { id: number; realBalance: number }) => api.post(`/api/wallets/${id}/adjust`, { realBalance }));

export const useSaveCategory = () =>
  useWrite(({ id, input }: { id?: number; input: CategoryInput }) => (id ? api.put<Category>(`/api/categories/${id}`, input) : api.post<Category>("/api/categories", input)));
export const useDeleteCategory = () => useWrite(({ id, reassignTo }: { id: number; reassignTo: number | null }) => api.del(`/api/categories/${id}${reassignTo ? `?reassignTo=${reassignTo}` : ""}`));

export const useSaveRecurrence = () =>
  useWrite(({ id, input }: { id?: number; input: RecurrenceInput }) => (id ? api.put<Recurrence>(`/api/recurrences/${id}`, input) : api.post<Recurrence>("/api/recurrences", input)));
export const useDeleteRecurrence = () => useWrite((id: number) => api.del(`/api/recurrences/${id}`));

export const useSetBudget = () => useWrite(({ categoryId, amount }: { categoryId: number; amount: number }) => api.put("/api/budgets", { categoryId, amount }));

export const useSaveProject = () =>
  useWrite(({ id, input }: { id?: number; input: ProjectInput }) => (id ? api.put<Project>(`/api/projects/${id}`, input) : api.post<Project>("/api/projects", input)));
export const useDeleteProject = () => useWrite((id: number) => api.del(`/api/projects/${id}`));
export const useContribute = () => useWrite(({ id, amount, fromWalletId }: { id: number; amount: number; fromWalletId: number }) => api.post(`/api/projects/${id}/contribute`, { amount, fromWalletId }));

export const useSaveSettings = () => useWrite((body: Record<string, string>) => api.put("/api/settings", body));
export const useRestoreBackup = () => useWrite((data: unknown) => api.post("/api/backup.json", data));

// ---- MVC 2 ----
export const useConfirmTransaction = () => useWrite((id: number) => api.post<Transaction>(`/api/transactions/${id}/confirm`));
export const categorize = (label: string) => api.get<CategorySuggestion>(`/api/categorize?label=${encodeURIComponent(label)}`);
export const useParseSpeech = () => useMutation({ mutationFn: (text: string) => api.post<TransactionDraft>("/api/ai/parse", { text }) });
export const useExtractReceipt = () =>
  useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("photo", file);
      return api.post<TransactionDraft>("/api/ai/receipt", form);
    },
  });
export type ImportPreviewResult = ImportPreview & { csv: string; banks: string[] };
export const useImportPreview = () =>
  useMutation({
    mutationFn: ({ file, walletId, bank, mapping }: { file: File; walletId: number; bank: string; mapping?: ImportColumnMapping }) => {
      const form = new FormData();
      form.append("file", file);
      form.append("walletId", String(walletId));
      form.append("bank", bank);
      if (mapping) form.append("mapping", JSON.stringify(mapping));
      return api.post<ImportPreviewResult>("/api/import/preview", form);
    },
  });
export const useImportCommit = () => useWrite((input: ImportCommitInput) => api.post<ImportBatch>("/api/import/commit", input));
export const useImports = () => useQuery({ queryKey: ["imports"], queryFn: () => api.get<ImportBatch[]>("/api/imports") });
export const useCancelImport = () => useWrite((id: number) => api.del<{ deleted: number }>(`/api/imports/${id}`));
export interface Rule { id: number; pattern: string; categoryId: number; categoryName: string; hits: number }
export const useRules = () => useQuery({ queryKey: ["rules"], queryFn: () => api.get<Rule[]>("/api/rules") });
export const useDeleteRule = () => useWrite((id: number) => api.del(`/api/rules/${id}`));

// ---- MVC 3 ----
export const useWeeklyAdvice = () => useQuery({ queryKey: ["weeklyAdvice"], queryFn: () => api.get<WeeklyAdvice>("/api/coach/weekly"), staleTime: 60_000 });
export const useRefreshAdvice = () => useWrite(() => api.get<WeeklyAdvice>("/api/coach/weekly?refresh=1"));
export const useChat = () => useQuery({ queryKey: ["chat"], queryFn: () => api.get<ChatMessage[]>("/api/coach/chat") });
export const useSendChat = () => useWrite((message: string) => api.post<ChatMessage>("/api/coach/chat", { message }));
export const useClearChat = () => useWrite(() => api.del("/api/coach/chat"));

// ---- Habitudes ----
export const useHabits = (type: TxType, categoryId: number | null, amount: number | null) =>
  useQuery({
    queryKey: ["habits", type, categoryId, amount],
    queryFn: () => api.get<HabitSuggestion[]>(`/api/transactions/habits?type=${type}&categoryId=${categoryId ?? ""}&amount=${amount ?? ""}`),
    enabled: type !== "transfer" && (categoryId !== null || (amount !== null && amount > 0)),
    placeholderData: (prev) => prev,
  });
