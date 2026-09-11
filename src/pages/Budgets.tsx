import { useState } from "react";
import { useBudgets, useSetBudget } from "@/lib/queries";
import { Money, MonthNav, ProgressBar, Sheet, MoneyInput, ErrorBanner } from "@/components/ui";
import { currentMonth } from "@shared/dates";
import type { BudgetLine } from "@shared/types";

export function BudgetsPage() {
  const [month, setMonth] = useState(currentMonth());
  const { data = [] } = useBudgets(month);
  const [editing, setEditing] = useState<BudgetLine | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const save = useSetBudget();

  const withBudget = data.filter((b) => b.amount > 0);
  const totalBudget = withBudget.reduce((s, b) => s + b.amount, 0);
  const totalSpent = withBudget.reduce((s, b) => s + b.spent, 0);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Budgets</h1>
      <MonthNav month={month} onChange={setMonth} />
      {totalBudget > 0 && (
        <div className="card">
          <div className="mb-1 flex justify-between text-sm"><span>Total des budgets</span><span><Money cents={totalSpent} /> / <Money cents={totalBudget} /></span></div>
          <ProgressBar ratio={totalSpent / totalBudget} status={totalSpent > totalBudget ? "red" : totalSpent / totalBudget >= 0.8 ? "orange" : "green"} />
        </div>
      )}
      <p className="text-sm text-slate-500">Touchez une catégorie pour fixer son budget mensuel. Il est reconduit chaque mois.</p>
      <div className="space-y-2">
        {data.map((b) => (
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
            {b.status === "green" && <p className="mt-1 text-xs text-slate-500">Il reste <Money cents={b.amount - b.spent} /></p>}
          </button>
        ))}
      </div>

      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing ? `Budget ${editing.categoryName}` : ""}>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!editing) return;
            await save.mutateAsync({ categoryId: editing.categoryId, amount: amount ?? 0 });
            setEditing(null);
          }}
        >
          <MoneyInput value={amount} onChange={setAmount} autoFocus />
          <p className="text-sm text-slate-500">Montant par mois. Mettez 0 pour retirer le budget.</p>
          <ErrorBanner error={save.error} />
          <button className="btn-primary w-full" disabled={save.isPending}>Enregistrer</button>
        </form>
      </Sheet>
    </div>
  );
}
