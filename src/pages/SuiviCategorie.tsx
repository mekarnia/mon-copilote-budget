import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useCategories } from "@/lib/queries";
import { Money, Empty, useGoBack } from "@/components/ui";
import { dayLabel, monthLabel } from "@shared/dates";
import type { Transaction } from "@shared/types";
import { PERIODS, type PeriodKey } from "./Suivi";

interface Range { from: string; to: string; granularity: "day" | "month" }

export function SuiviCategoriePage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const type = params.get("type") === "income" ? "income" : "expense";
  const period = (PERIODS.some((p) => p.value === params.get("p")) ? params.get("p") : "1m") as PeriodKey;
  const categoryId = Number(id);
  const { data: categories = [] } = useCategories();
  const cat = categories.find((c) => c.id === categoryId);
  const parent = cat?.parentId ? categories.find((c) => c.id === cat.parentId) : null;
  const { data: range } = useQuery({ queryKey: ["periodRange", period], queryFn: () => api.get<{ range: Range }>(`/api/stats/period?type=${type}&period=${period}`).then((r) => r.range) });
  const { data = [], isLoading } = useQuery({
    queryKey: ["catPeriodTx", categoryId, type, range?.from, range?.to],
    queryFn: () => api.get<Transaction[]>(`/api/transactions?categoryId=${categoryId}&type=${type}&from=${range!.from}&to=${range!.to}&limit=500`),
    enabled: !!range,
  });
  const groups = new Map<string, Transaction[]>();
  for (const t of data) groups.set(t.date, [...(groups.get(t.date) ?? []), t]);
  const total = data.reduce((s, t) => s + t.amount, 0);
  const back = `/suivi?vue=${type === "income" ? "revenus" : "depenses"}&p=${period}`;
  const goBack = useGoBack();
  const periodLabel = PERIODS.find((p) => p.value === period)?.label;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button className="btn-ghost shrink-0 px-3 py-2" onClick={goBack} aria-label="Retour">‹</button>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold">{cat ? `${parent ? `${parent.icon ?? ""} ${parent.name} › ` : `${cat.icon ?? ""} `}${cat.name}` : "Catégorie"}</h1>
          <p className="text-xs text-slate-500">{periodLabel}{range && ` · du ${range.from.slice(8, 10)}/${range.from.slice(5, 7)} au ${range.to.slice(8, 10)}/${range.to.slice(5, 7)}`} · <Link to={back} className="text-brand">retour à l'indicateur</Link></p>
        </div>
      </div>
      <div className="flex items-baseline justify-between px-1">
        <span className="text-sm text-slate-500">{data.length} transaction{data.length > 1 ? "s" : ""}</span>
        <Money cents={total} className="text-2xl font-bold" />
      </div>
      {isLoading && <p className="text-slate-500">Chargement…</p>}
      {!isLoading && data.length === 0 && <Empty icon="🗒️" text="Aucune transaction sur cette période." />}
      {[...groups.entries()].map(([date, items]) => (
        <section key={date}>
          <h2 className="mb-1 mt-2 text-sm font-semibold text-slate-500">{range?.granularity === "month" ? `${dayLabel(date)} · ${monthLabel(date.slice(0, 7))}` : dayLabel(date)}</h2>
          <div className="card divide-y divide-slate-100 p-0 dark:divide-slate-800">
            {items.map((t) => (
              <Link key={t.id} to={`/operation/${t.id}`} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{t.label || t.categoryName}</p>
                  <p className="truncate text-sm text-slate-500">{t.time && <span className="mr-1 tabular-nums">{t.time}</span>}{t.categoryName} · {t.paymentMethod === "cash" ? "Espèces" : t.paymentMethod === "card" ? "Carte" : t.walletName}</p>
                </div>
                <Money cents={type === "income" ? t.amount : -t.amount} signed className={`font-semibold ${type === "income" ? "text-emerald-600" : ""}`} />
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
