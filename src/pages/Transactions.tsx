import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useCategories, useToVerifyCount, useTransactions } from "@/lib/queries";
import { Money, MonthNav, Empty } from "@/components/ui";
import { currentMonth, dayLabel, monthLabel } from "@shared/dates";
import type { Transaction } from "@shared/types";

function amountOf(t: Transaction) {
  if (t.type === "income") return { cents: t.amount, cls: "text-emerald-600" };
  if (t.type === "transfer") return { cents: t.amount, cls: "text-slate-500" };
  return { cents: -t.amount, cls: "" };
}

export function TransactionsPage() {
  const [params, setParams] = useSearchParams();
  const categoryId = params.get("categoryId") ? Number(params.get("categoryId")) : null;
  const allMonths = params.get("all") === "1";
  const [month, setMonth] = useState(params.get("month") ?? currentMonth());
  const [q, setQ] = useState("");
  const [onlyToVerify, setOnlyToVerify] = useState(false);
  const [pickedMonth, setPickedMonth] = useState<string | null>(null); // filtre de la rangée « toutes périodes »
  const { data: fetched = [], isLoading } = useTransactions(allMonths ? null : month, q, onlyToVerify ? "to_verify" : undefined, categoryId);
  const availableMonths = allMonths ? [...new Set(fetched.map((t) => t.date.slice(0, 7)))].sort().reverse() : [];
  const data = allMonths && pickedMonth ? fetched.filter((t) => t.date.startsWith(pickedMonth)) : fetched;
  const { data: categories = [] } = useCategories();
  const filterCat = categories.find((c) => c.id === categoryId);
  const filterParent = filterCat?.parentId ? categories.find((c) => c.id === filterCat.parentId) : null;
  const { data: toVerify } = useToVerifyCount();

  const groups = new Map<string, Transaction[]>();
  for (const t of data) groups.set(t.date, [...(groups.get(t.date) ?? []), t]);
  const spent = data.filter((t) => t.type === "expense" && !t.technical).reduce((s, t) => s + t.amount, 0);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Opérations</h1>
      {!onlyToVerify && !allMonths && <MonthNav month={month} onChange={setMonth} />}
      {filterCat && (
        <button className="chip w-full bg-brand/10 text-left" onClick={() => { setParams({}); setPickedMonth(null); }}>
          {filterParent ? `${filterParent.icon ?? ""} ${filterParent.name} › ` : `${filterCat.icon ?? ""} `}{filterCat.name}
          {allMonths && " · toutes périodes"} <span className="text-slate-500">✕ retirer</span>
        </button>
      )}
      {allMonths && availableMonths.length > 0 && (
        <div className="scroll-row -mx-4 px-4">
          <button className={`chip shrink-0 ${pickedMonth === null ? "bg-brand text-white" : "bg-slate-100 dark:bg-slate-800"}`} onClick={() => setPickedMonth(null)}>Tout</button>
          {availableMonths.map((m) => (
            <button key={m} className={`chip shrink-0 capitalize ${pickedMonth === m ? "bg-brand text-white" : "bg-slate-100 dark:bg-slate-800"}`} onClick={() => setPickedMonth(m)}>
              {monthLabel(m)}
            </button>
          ))}
        </div>
      )}
      {(toVerify?.count ?? 0) > 0 && (
        <button className={`chip w-full text-left ${onlyToVerify ? "bg-amber-600 text-white" : "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200"}`} onClick={() => setOnlyToVerify((v) => !v)}>
          {onlyToVerify ? "← Retour à toutes les opérations" : `⚠️ ${toVerify!.count} opération${toVerify!.count > 1 ? "s" : ""} importée${toVerify!.count > 1 ? "s" : ""} à vérifier`}
        </button>
      )}
      <input className="input" placeholder="Rechercher un libellé, une catégorie…" value={q} onChange={(e) => setQ(e.target.value)} />
      <p className="text-sm text-slate-500">{allMonths && !pickedMonth ? "Dépensé au total" : "Dépensé sur la période"} : <Money cents={spent} className="font-semibold text-slate-900 dark:text-slate-100" /> <span className="text-slate-400">· {data.length} opération{data.length > 1 ? "s" : ""}</span></p>

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
                      {t.time && <span className="mr-1 tabular-nums">{t.time}</span>}
                      {t.type === "transfer" ? "Virement interne" : `${t.categoryName ?? "Sans catégorie"} · ${t.paymentMethod === "cash" ? "💵" : t.paymentMethod === "card" ? "💳" : ""} ${t.walletName}`}
                      {t.photoPath && " · 📷"}
                      {t.status === "to_verify" && <span className="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-800 dark:bg-amber-900 dark:text-amber-200">à vérifier</span>}
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
