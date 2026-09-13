import { useState } from "react";
import { useApplyBudgets, useBudgets, useCopyBudgets, useSetBudget, useSuggestBudgets, type BudgetSuggestion } from "@/lib/queries";
import { Money, MonthNav, ProgressBar, Sheet, MoneyInput, ErrorBanner, PageHeader } from "@/components/ui";
import { currentMonth, monthLabel, shiftMonth } from "@shared/dates";
import { formatCents } from "@shared/money";
import type { BudgetLine } from "@shared/types";

export function BudgetsPage() {
  const [month, setMonth] = useState(currentMonth());
  const { data } = useBudgets(month);
  const lines = data?.lines ?? [];
  const summary = data?.summary;
  const [editing, setEditing] = useState<BudgetLine | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const save = useSetBudget();
  const copy = useCopyBudgets();
  const suggest = useSuggestBudgets();
  const apply = useApplyBudgets();
  const [suggestions, setSuggestions] = useState<{ month: string; items: (BudgetSuggestion & { keep: boolean })[]; generatedBy: "ai" | "template" } | null>(null);

  const nextMonth = shiftMonth(month, 1);

  async function openSuggestions(target: string) {
    const r = await suggest.mutateAsync(target);
    setSuggestions({ month: target, items: r.items.map((i) => ({ ...i, keep: i.suggested > 0 })), generatedBy: r.generatedBy });
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Budgets" />
      <MonthNav month={month} onChange={setMonth} />
      <p className="text-xs text-slate-500">Chaque mois a ses propres budgets. Modifier {monthLabel(month)} ne change pas les autres mois.</p>

      {summary?.hasBudgets && (
        <div className="card space-y-2">
          <div className="flex justify-between text-sm"><span>Budget total</span><Money cents={summary.budget} className="font-semibold" /></div>
          <div className="flex justify-between text-sm"><span>Dépensé</span><Money cents={summary.spent} className="font-semibold" /></div>
          <ProgressBar ratio={summary.budget > 0 ? summary.spent / summary.budget : 0} status={summary.spent > summary.budget ? "red" : summary.spent / summary.budget >= 0.8 ? "orange" : "green"} />
          <div className={`flex justify-between text-sm font-semibold ${summary.saved >= 0 ? "text-emerald-600" : "text-red-600"}`}>
            <span>{summary.saved >= 0 ? "Économies réalisées" : "Dépassement"}</span><Money cents={Math.abs(summary.saved)} />
          </div>
        </div>
      )}

      {summary && !summary.hasBudgets && (
        <div className="card space-y-2 text-sm">
          <p>Aucun budget pour {monthLabel(month)}.</p>
          <div className="grid gap-2">
            {summary.previousMonthHasBudgets && (
              <button className="btn-ghost" onClick={() => copy.mutate({ from: shiftMonth(month, -1), to: month })} disabled={copy.isPending}>Reprendre les budgets de {monthLabel(shiftMonth(month, -1))}</button>
            )}
            <button className="btn-primary" onClick={() => openSuggestions(month)} disabled={suggest.isPending}>{suggest.isPending ? "Calcul…" : "🤖 Suggérer d'après mes dépenses"}</button>
          </div>
        </div>
      )}

      <p className="text-sm text-slate-500">Touchez une catégorie pour fixer son budget du mois.</p>
      <div className="space-y-2">
        {lines.map((b) => (
          <button key={b.categoryId} className="card block w-full text-left" onClick={() => { setEditing(b); setAmount(b.amount || null); }}>
            <div className="mb-1 flex items-center justify-between">
              <span className="font-medium">{b.icon} {b.categoryName}</span>
              <span className="text-sm">
                <Money cents={b.spent} className="font-semibold" />
                {b.amount > 0 ? <span className="text-slate-500"> / <Money cents={b.amount} /></span> : <span className="text-slate-400"> · pas de budget</span>}
              </span>
            </div>
            <ProgressBar ratio={b.ratio} status={b.status} />
            {b.status === "red" && <p className="mt-1 text-xs text-red-600">Dépassé de <Money cents={b.spent - b.amount} /></p>}
            {(b.status === "green" || b.status === "orange") && <p className="mt-1 text-xs text-slate-500">Il reste <Money cents={b.amount - b.spent} /></p>}
          </button>
        ))}
      </div>

      {summary?.hasBudgets && (
        <button className="btn-primary w-full" onClick={() => openSuggestions(nextMonth)} disabled={suggest.isPending}>
          {suggest.isPending ? "Calcul…" : `🤖 Préparer les budgets de ${monthLabel(nextMonth)}`}
        </button>
      )}
      <ErrorBanner error={suggest.error || copy.error} />

      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing ? `${editing.categoryName} · ${monthLabel(month)}` : ""}>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!editing) return;
            await save.mutateAsync({ categoryId: editing.categoryId, month, amount: amount ?? 0 });
            setEditing(null);
          }}
        >
          <MoneyInput value={amount} onChange={setAmount} autoFocus />
          <p className="text-sm text-slate-500">Budget pour ce mois uniquement. Mettez 0 pour le retirer.</p>
          <ErrorBanner error={save.error} />
          <button className="btn-primary w-full" disabled={save.isPending}>Enregistrer</button>
        </form>
      </Sheet>

      <Sheet open={suggestions !== null} onClose={() => setSuggestions(null)} title={suggestions ? `Budgets suggérés · ${monthLabel(suggestions.month)}` : ""}>
        {suggestions && (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">
              {suggestions.generatedBy === "ai" ? "Calculés d'après vos dépenses des trois derniers mois et affinés par l'IA." : "Calculés d'après vos dépenses des trois derniers mois. Ajoutez une clé IA pour un avis plus fin."}
              {" "}Décochez ce que vous ne voulez pas appliquer, ou touchez un montant pour le changer.
            </p>
            {suggestions.items.length === 0 && <p className="text-sm">Pas encore assez de dépenses pour proposer des budgets.</p>}
            {suggestions.items.map((it, idx) => (
              <div key={it.categoryId} className={`card space-y-1 ${it.keep ? "" : "opacity-50"}`}>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 font-medium">
                    <input type="checkbox" checked={it.keep} onChange={(e) => setSuggestions({ ...suggestions, items: suggestions.items.map((x, i) => (i === idx ? { ...x, keep: e.target.checked } : x)) })} />
                    {it.icon} {it.categoryName}
                  </label>
                  <input
                    inputMode="decimal"
                    className="input w-28 py-1.5 text-right font-semibold"
                    value={(it.suggested / 100).toFixed(0)}
                    onChange={(e) => {
                      const v = Math.round(Number(e.target.value.replace(",", ".")) * 100);
                      if (!Number.isNaN(v)) setSuggestions({ ...suggestions, items: suggestions.items.map((x, i) => (i === idx ? { ...x, suggested: v } : x)) });
                    }}
                  />
                </div>
                <p className="text-xs text-slate-500">{it.reason}</p>
                <p className="text-xs text-slate-500">
                  Mois dernier : {formatCents(it.lastSpent)} dépensés{it.previousBudget > 0 && ` pour ${formatCents(it.previousBudget)} de budget`}
                  {it.previousBudget > 0 && (it.saved >= 0 ? ` · ${formatCents(it.saved)} économisés` : ` · dépassé de ${formatCents(-it.saved)}`)}
                </p>
              </div>
            ))}
            <ErrorBanner error={apply.error} />
            <button
              className="btn-primary w-full"
              disabled={apply.isPending || suggestions.items.every((i) => !i.keep)}
              onClick={async () => {
                await apply.mutateAsync({ month: suggestions.month, items: suggestions.items.filter((i) => i.keep).map((i) => ({ categoryId: i.categoryId, amount: i.suggested })) });
                setMonth(suggestions.month);
                setSuggestions(null);
              }}
            >
              Appliquer à {monthLabel(suggestions.month)}
            </button>
          </div>
        )}
      </Sheet>
    </div>
  );
}
