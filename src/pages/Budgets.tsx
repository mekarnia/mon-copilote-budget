import { useState } from "react";
import { useApplyBudgets, useBudgets, useCopyBudgets, useSetBudget, useSuggestBudgets, type BudgetSuggestion } from "@/lib/queries";
import { Money, ProgressBar, Sheet, MoneyInput, ErrorBanner, Bandeau } from "@/components/ui";
import { CategoryBadge, IconLeft, IconRight, IconRight as IconChevron, IconRobot } from "@/components/icons";
import { currentMonth, deMois, monthLabel, shiftMonth } from "@shared/dates";
import { formatCents } from "@shared/money";
import type { BudgetLine } from "@shared/types";

export function BudgetsPage() {
  const [month, setMonth] = useState(currentMonth());
  const { data } = useBudgets(month);
  const lines = data?.lines ?? [];
  // Une catégorie sans budget ne porte aucune décision : elle ne doit pas peser autant qu'une autre.
  const avecBudget = lines.filter((b) => b.amount > 0);
  const sansBudget = lines.filter((b) => b.amount <= 0);
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
      <Bandeau>
        <div className="flex items-center justify-between">
          <button onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Mois précédent" className="-ml-2 flex size-11 items-center justify-center text-white/80"><IconLeft size={22} /></button>
          <span className="text-[17px] font-semibold capitalize">{monthLabel(month)}</span>
          <button onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Mois suivant" className="-mr-2 flex size-11 items-center justify-center text-white/80"><IconRight size={22} /></button>
        </div>
        {summary?.hasBudgets ? (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              {/* « Il reste » et non « Économies réalisées » : le mois n'est pas fini. */}
              <p className="text-[13px] text-white/75">{summary.saved >= 0 ? "Il reste sur vos budgets" : "Dépassement"}</p>
              <p className="text-[12px] tabular-nums text-white/75"><Money cents={summary.spent} short /> / <Money cents={summary.budget} short /></p>
            </div>
            <p className="text-[30px] font-bold tabular-nums"><Money cents={Math.abs(summary.saved)} short /></p>
            <div className="h-[7px] rounded-full bg-white/25">
              <div className="h-[7px] rounded-full bg-white" style={{ width: `${Math.min(100, Math.round((summary.budget > 0 ? summary.spent / summary.budget : 0) * 100))}%` }} />
            </div>
          </div>
        ) : (
          <p className="text-[13px] text-white/80">Aucun budget pour {monthLabel(month)}. Touchez une catégorie pour en fixer un.</p>
        )}
      </Bandeau>

      {summary && !summary.hasBudgets && (
        <div className="card space-y-2 text-sm">
          <p>Aucun budget pour {monthLabel(month)}.</p>
          <div className="grid gap-2">
            {summary.previousMonthHasBudgets && (
              <button className="btn-ghost" onClick={() => copy.mutate({ from: shiftMonth(month, -1), to: month })} disabled={copy.isPending}>Reprendre les budgets de {monthLabel(shiftMonth(month, -1))}</button>
            )}
            <button className="btn-primary" onClick={() => openSuggestions(month)} disabled={suggest.isPending}>{suggest.isPending ? "Calcul…" : "Suggérer d'après mes dépenses"}</button>
          </div>
        </div>
      )}

      {avecBudget.length > 0 && (
        <div className="space-y-2">
          <h2 className="font-semibold">Vos budgets du mois</h2>
          {avecBudget.map((b) => (
            <button key={b.categoryId} className="card block w-full space-y-2 text-left" onClick={() => { setEditing(b); setAmount(b.amount || null); }}>
              <div className="flex items-center gap-3">
                <CategoryBadge name={b.categoryName} size={34} />
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{b.categoryName}</span>
                <span className={`shrink-0 text-[13px] font-semibold ${b.status === "red" ? "text-red-600" : b.status === "orange" ? "text-amber-600" : "text-brand"}`}>
                  {b.status === "red" ? <>Dépassé de <Money cents={b.spent - b.amount} short /></> : <>Il reste <Money cents={b.amount - b.spent} short /></>}
                </span>
              </div>
              <ProgressBar ratio={b.ratio} status={b.status} />
              <p className="text-[12px] text-slate-500"><Money cents={b.spent} short /> dépensés sur <Money cents={b.amount} short /></p>
            </button>
          ))}
        </div>
      )}

      {sansBudget.length > 0 && (
        <div className="space-y-2">
          <h2 className="font-semibold text-slate-500">Sans budget</h2>
          <div className="card divide-y divide-slate-100 p-0 px-3.5 dark:divide-slate-800">
            {sansBudget.map((b) => (
              <button key={b.categoryId} className="flex h-[46px] w-full items-center gap-2 text-left" onClick={() => { setEditing(b); setAmount(null); }}>
                <span className="min-w-0 flex-1 truncate text-sm text-slate-700 dark:text-slate-300">{b.categoryName}</span>
                <span className="shrink-0 text-[13px] text-slate-500"><Money cents={b.spent} short /> dépensé{b.spent > 0 ? "s" : ""}</span>
                <IconChevron size={17} className="shrink-0 text-slate-400" />
              </button>
            ))}
          </div>
        </div>
      )}

      {summary?.hasBudgets && (
        <button className="btn-primary w-full" onClick={() => openSuggestions(nextMonth)} disabled={suggest.isPending}>
          {suggest.isPending ? "Calcul…" : <><IconRobot size={19} />Préparer les budgets {deMois(monthLabel(nextMonth).replace(/\s\d{4}$/, ""))}</>}
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
                    className="input w-32 py-1.5 text-right font-semibold"
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
