import { useState } from "react";
import { Link } from "react-router-dom";
import { useTransactions } from "@/lib/queries";
import { Money, MonthNav, Empty } from "@/components/ui";
import { currentMonth, dayLabel } from "@shared/dates";
import type { Transaction } from "@shared/types";

function amountOf(t: Transaction) {
  if (t.type === "income") return { cents: t.amount, cls: "text-emerald-600" };
  if (t.type === "transfer") return { cents: t.amount, cls: "text-slate-500" };
  return { cents: -t.amount, cls: "" };
}

export function TransactionsPage() {
  const [month, setMonth] = useState(currentMonth());
  const [q, setQ] = useState("");
  const { data = [], isLoading } = useTransactions(month, q);

  const groups = new Map<string, Transaction[]>();
  for (const t of data) groups.set(t.date, [...(groups.get(t.date) ?? []), t]);
  const spent = data.filter((t) => t.type === "expense" && !t.technical).reduce((s, t) => s + t.amount, 0);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Opérations</h1>
      <MonthNav month={month} onChange={setMonth} />
      <input className="input" placeholder="Rechercher un libellé, une catégorie…" value={q} onChange={(e) => setQ(e.target.value)} />
      <p className="text-sm text-slate-500">Dépensé sur la période : <Money cents={spent} className="font-semibold text-slate-900 dark:text-slate-100" /></p>

      {isLoading && <p className="text-slate-500">Chargement…</p>}
      {!isLoading && data.length === 0 && <Empty icon="🗒️" text="Aucune opération sur ce mois." />}

      {[...groups.entries()].map(([date, items]) => (
        <section key={date}>
          <h2 className="mb-1 mt-2 text-sm font-semibold text-slate-500">{dayLabel(date)}</h2>
          <div className="card divide-y divide-slate-100 p-0 dark:divide-slate-800">
            {items.map((t) => {
              const a = amountOf(t);
              return (
                <Link key={t.id} to={`/operation/${t.id}`} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {t.type === "transfer" ? `${t.walletName} → ${t.toWalletName}` : t.label || t.categoryName}
                    </p>
                    <p className="truncate text-sm text-slate-500">
                      {t.type === "transfer" ? "Virement interne" : `${t.categoryName ?? "Sans catégorie"} · ${t.walletName}`}
                      {t.photoPath && " · 📷"}
                    </p>
                  </div>
                  <Money cents={a.cents} signed={t.type !== "transfer"} className={`font-semibold ${a.cls}`} />
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
