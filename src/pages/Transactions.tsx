import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useCategories, useToVerifyCount, useTransactions } from "@/lib/queries";
import { Money, Empty, Bandeau } from "@/components/ui";
import { CategoryBadge, IconCard, IconCash, IconLeft, IconRight, IconSearch, IconWarning } from "@/components/icons";
import { currentMonth, dayLabel, monthLabel, shiftMonth } from "@shared/dates";
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
  const [pickedMonth, setPickedMonth] = useState<string | null>(null); // filtre de la rangée « toutes périodes »
  const { data: fetched = [], isLoading } = useTransactions(allMonths ? null : month, q, undefined, categoryId);
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
      <Bandeau>
        {!allMonths ? (
          <div className="flex items-center justify-between">
            <button onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Mois précédent" className="-ml-2 flex size-11 items-center justify-center text-white/80"><IconLeft size={22} /></button>
            <span className="text-[17px] font-semibold capitalize">{monthLabel(month)}</span>
            <button onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Mois suivant" className="-mr-2 flex size-11 items-center justify-center text-white/80"><IconRight size={22} /></button>
          </div>
        ) : (
          <p className="text-[17px] font-semibold">Toutes les transactions</p>
        )}
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[12px] text-white/75">Sorti sur la période</p>
            <p className="text-[27px] font-bold tabular-nums"><Money cents={spent} short /></p>
          </div>
          <p className="pb-1 text-[12px] text-white/75">{data.length} transaction{data.length > 1 ? "s" : ""}</p>
        </div>
      </Bandeau>
      {filterCat && (
        <button className="flex min-h-11 w-full items-center rounded-full bg-brand/10 px-3 text-left text-sm font-medium" onClick={() => { setParams({}); setPickedMonth(null); }}>
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
        <Link to="/verifier" className="flex min-h-12 items-center gap-2 rounded-2xl bg-amber-50 px-4 text-sm font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <IconWarning size={19} />
          <span className="flex-1">{toVerify!.count} transaction{toVerify!.count > 1 ? "s" : ""} à vérifier</span>
          <span className="font-semibold">Vérifier</span>
        </Link>
      )}
      <div className="relative">
        <IconSearch size={19} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className="input pl-11" placeholder="Rechercher un libellé, une catégorie…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {isLoading && <p className="text-slate-500">Chargement…</p>}
      {!isLoading && data.length === 0 && <Empty icon="🗒️" text="Aucune transaction sur ce mois." />}

      {[...groups.entries()].map(([date, items]) => (
        <section key={date}>
          <h2 className="mb-1 mt-2 text-sm font-semibold text-slate-500">{dayLabel(date)}</h2>
          <div className="space-y-2">
            {items.map((t) => {
              const a = amountOf(t);
              const parent = categories.find((c) => c.id === categories.find((x) => x.id === t.categoryId)?.parentId)?.name;
              return (
                <Link key={t.id} to={`/transaction/${t.id}`} className="card flex h-[62px] items-center gap-3 p-0 px-3.5">
                  <CategoryBadge name={t.categoryName} parentName={parent} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold">
                      {t.type === "transfer" ? `${t.walletName} → ${t.toWalletName}` : t.label || t.categoryName}
                    </p>
                    <p className="flex items-center gap-1 truncate text-[12px] text-slate-500">
                      {t.type === "transfer" ? "Virement interne" : t.categoryName ?? "Sans catégorie"}
                      {t.paymentMethod === "cash" && <><span>·</span><IconCash size={13} /></>}
                      {t.paymentMethod === "card" && <><span>·</span><IconCard size={13} /></>}
                      {t.time && <><span>·</span><span className="tabular-nums">{t.time}</span></>}
                      {t.status === "to_verify" && <span className="rounded bg-amber-100 px-1 text-[11px] text-amber-800 dark:bg-amber-900 dark:text-amber-200">à vérifier</span>}
                    </p>
                  </div>
                  <Money cents={a.cents} signed={t.type !== "transfer"} short className={`text-[15px] font-bold ${a.cls}`} />
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
