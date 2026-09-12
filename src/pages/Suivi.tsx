import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Money, MonthNav } from "@/components/ui";
import { currentMonth, monthLabel } from "@shared/dates";
import { formatCents } from "@shared/money";

interface MonthPoint { month: string; income: number; expense: number; saved: number; rate: number | null }
interface CategoryCompare { categoryId: number; name: string; icon: string | null; current: number; previous: number; delta: number }
interface Stats { month: string; monthly: MonthPoint[]; compare: CategoryCompare[]; savings: { current: MonthPoint; previous: MonthPoint; average6Rate: number | null; bestMonth: MonthPoint | null } }

export const VIEWS = [
  { key: "mois", label: "12 mois", icon: "📊" },
  { key: "comparaison", label: "Mois vs précédent", icon: "⚖️" },
  { key: "epargne", label: "Épargne", icon: "🐷" },
] as const;
type ViewKey = (typeof VIEWS)[number]["key"];

const short = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString("fr-FR", { month: "short" }).replace(".", "");
};

export function SuiviPage() {
  const [params, setParams] = useSearchParams();
  const view = (VIEWS.some((v) => v.key === params.get("vue")) ? params.get("vue") : "mois") as ViewKey;
  const [month, setMonth] = useState(currentMonth());
  const { data } = useQuery({ queryKey: ["stats", month], queryFn: () => api.get<Stats>(`/api/stats?month=${month}`) });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Suivi</h1>
      <div className="scroll-row -mx-4 px-4">
        {VIEWS.map((v) => (
          <button key={v.key} className={`chip shrink-0 ${view === v.key ? "bg-brand text-white" : "bg-slate-100 dark:bg-slate-800"}`} onClick={() => setParams({ vue: v.key })}>
            {v.icon} {v.label}
          </button>
        ))}
      </div>
      <MonthNav month={month} onChange={setMonth} />
      {!data ? <p className="text-slate-500">Chargement…</p> : view === "mois" ? <MonthlyView data={data} /> : view === "comparaison" ? <CompareView data={data} /> : <SavingsView data={data} />}
    </div>
  );
}

/* ---------- Vue 1 : 12 mois en barres, dépenses et revenus ---------- */
function MonthlyView({ data }: { data: Stats }) {
  const [hover, setHover] = useState<number | null>(null);
  const pts = data.monthly;
  const max = Math.max(1, ...pts.map((p) => Math.max(p.income, p.expense)));
  const W = 360, H = 180, padL = 8, padB = 22, padT = 8;
  const innerW = W - padL * 2, innerH = H - padB - padT;
  const slot = innerW / pts.length, barW = Math.max(4, slot * 0.32), gap = 2;
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const sel = hover !== null ? pts[hover] : pts[pts.length - 1];
  const totalExp = pts.reduce((s, p) => s + p.expense, 0);
  return (
    <div className="space-y-3">
      <div className="card space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold capitalize">{monthLabel(sel.month)}</span>
          <span className="flex gap-3">
            <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#2a78d6] dark:bg-[#3987e5]" />Dépenses <b>{formatCents(sel.expense)}</b></span>
            <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#1baf7a] dark:bg-[#199e70]" />Revenus <b>{formatCents(sel.income)}</b></span>
          </span>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Dépenses et revenus sur 12 mois" onMouseLeave={() => setHover(null)}>
          {[0.5, 1].map((f) => <line key={f} x1={padL} x2={W - padL} y1={y(max * f)} y2={y(max * f)} className="stroke-slate-200 dark:stroke-slate-700" strokeWidth={1} />)}
          <line x1={padL} x2={W - padL} y1={y(0)} y2={y(0)} className="stroke-slate-300 dark:stroke-slate-600" strokeWidth={1} />
          {pts.map((p, i) => {
            const x0 = padL + i * slot + (slot - barW * 2 - gap) / 2;
            const active = hover === i || (hover === null && i === pts.length - 1);
            return (
              <g key={p.month} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} onTouchStart={() => setHover(i)} opacity={hover === null || active ? 1 : 0.45}>
                <rect x={padL + i * slot} y={padT} width={slot} height={innerH} fill="transparent" />
                <rect x={x0} y={y(p.expense)} width={barW} height={Math.max(0, y(0) - y(p.expense))} rx={2} className="fill-[#2a78d6] dark:fill-[#3987e5]" />
                <rect x={x0 + barW + gap} y={y(p.income)} width={barW} height={Math.max(0, y(0) - y(p.income))} rx={2} className="fill-[#1baf7a] dark:fill-[#199e70]" />
                <text x={padL + i * slot + slot / 2} y={H - 6} textAnchor="middle" fontSize={10} className={`fill-slate-500 ${active ? "font-semibold" : ""}`}>{short(p.month)}</text>
              </g>
            );
          })}
        </svg>
        <p className="text-xs text-slate-500">Touchez un mois pour voir ses chiffres. Sur 12 mois : {formatCents(totalExp)} de dépenses, soit {formatCents(Math.round(totalExp / 12))} par mois en moyenne.</p>
      </div>
      <details className="card text-sm">
        <summary className="cursor-pointer font-medium">Voir le tableau</summary>
        <table className="mt-2 w-full">
          <thead><tr className="text-left text-slate-500"><th>Mois</th><th className="text-right">Dépenses</th><th className="text-right">Revenus</th><th className="text-right">Reste</th></tr></thead>
          <tbody>{[...pts].reverse().map((p) => <tr key={p.month}><td className="capitalize">{monthLabel(p.month)}</td><td className="text-right tabular-nums">{formatCents(p.expense)}</td><td className="text-right tabular-nums">{formatCents(p.income)}</td><td className={`text-right tabular-nums ${p.saved < 0 ? "text-red-600" : ""}`}>{formatCents(p.saved)}</td></tr>)}</tbody>
        </table>
      </details>
    </div>
  );
}

/* ---------- Vue 2 : mois en cours contre mois précédent, par catégorie ---------- */
function CompareView({ data }: { data: Stats }) {
  const rows = data.compare;
  const max = Math.max(1, ...rows.map((r) => Math.max(r.current, r.previous)));
  const prev = data.savings.previous, cur = data.savings.current;
  return (
    <div className="space-y-3">
      <div className="card space-y-1 text-sm">
        <div className="flex justify-between"><span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#2a78d6] dark:bg-[#3987e5]" /><span className="capitalize">{monthLabel(cur.month)}</span></span><b>{formatCents(cur.expense)}</b></div>
        <div className="flex justify-between"><span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#eb6834] dark:bg-[#d95926]" /><span className="capitalize">{monthLabel(prev.month)}</span></span><b>{formatCents(prev.expense)}</b></div>
        <div className={`flex justify-between font-semibold ${cur.expense - prev.expense > 0 ? "text-red-600" : "text-emerald-600"}`}>
          <span>Écart</span><span>{cur.expense - prev.expense > 0 ? "+" : ""}{formatCents(cur.expense - prev.expense)}</span>
        </div>
      </div>
      {rows.length === 0 && <p className="card text-sm text-slate-500">Pas encore de dépenses sur ces deux mois.</p>}
      {rows.map((r) => (
        <div key={r.categoryId} className="card space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">{r.icon} {r.name}</span>
            <span className={`text-xs font-semibold ${r.delta > 0 ? "text-red-600" : r.delta < 0 ? "text-emerald-600" : "text-slate-500"}`}>{r.delta > 0 ? "+" : ""}{formatCents(r.delta)}</span>
          </div>
          <Bar value={r.current} max={max} cls="bg-[#2a78d6] dark:bg-[#3987e5]" label={formatCents(r.current)} />
          <Bar value={r.previous} max={max} cls="bg-[#eb6834] dark:bg-[#d95926]" label={formatCents(r.previous)} />
        </div>
      ))}
    </div>
  );
}

function Bar({ value, max, cls, label }: { value: number; max: number; cls: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2.5 flex-1 rounded-full bg-slate-100 dark:bg-slate-800"><div className={`h-full rounded-full ${cls}`} style={{ width: `${Math.max(value > 0 ? 2 : 0, (value / max) * 100)}%` }} /></div>
      <span className="w-20 text-right text-xs tabular-nums text-slate-500">{label}</span>
    </div>
  );
}

/* ---------- Vue 3 : taux d'épargne ---------- */
function SavingsView({ data }: { data: Stats }) {
  const { current, previous, average6Rate, bestMonth } = data.savings;
  const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)} %`);
  const pts = data.monthly;
  const W = 360, H = 140, padL = 8, padB = 22, padT = 10;
  const innerW = W - padL * 2, innerH = H - padB - padT;
  const slot = innerW / pts.length;
  const yRate = (r: number) => padT + innerH - Math.min(1, Math.max(0, r)) * innerH;
  return (
    <div className="space-y-3">
      <div className="card text-center">
        <p className="text-sm text-slate-500">Taux d'épargne · <span className="capitalize">{monthLabel(current.month)}</span></p>
        <p className={`my-1 text-5xl font-bold ${current.rate !== null && current.rate < 0 ? "text-red-600" : "text-emerald-600"}`}>{pct(current.rate)}</p>
        <p className="text-sm text-slate-500">{current.income > 0 ? <><Money cents={current.saved} className="font-semibold" /> non dépensés sur <Money cents={current.income} /> de revenus</> : "Aucun revenu saisi ce mois-ci"}</p>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center text-sm">
        <div className="card p-3"><p className="text-xs text-slate-500">Mois précédent</p><p className="font-semibold">{pct(previous.rate)}</p></div>
        <div className="card p-3"><p className="text-xs text-slate-500">Moyenne 6 mois</p><p className="font-semibold">{pct(average6Rate)}</p></div>
        <div className="card p-3"><p className="text-xs text-slate-500">Meilleur mois</p><p className="font-semibold">{bestMonth ? `${pct(bestMonth.rate)} · ${short(bestMonth.month)}` : "—"}</p></div>
      </div>
      <div className="card space-y-2">
        <p className="text-sm font-semibold">Sur 12 mois</p>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Taux d'épargne sur 12 mois">
          {[0, 0.25, 0.5, 1].map((f) => <line key={f} x1={padL} x2={W - padL} y1={yRate(f)} y2={yRate(f)} className={f === 0 ? "stroke-slate-300 dark:stroke-slate-600" : "stroke-slate-200 dark:stroke-slate-700"} strokeWidth={1} />)}
          {pts.map((p, i) => {
            const x = padL + i * slot + slot / 2;
            const r = p.rate;
            return (
              <g key={p.month}>
                {r !== null && <rect x={x - 5} y={yRate(Math.max(0, r))} width={10} height={Math.max(2, yRate(0) - yRate(Math.max(0, r)))} rx={2} className={r < 0 ? "fill-[#e34948] dark:fill-[#e66767]" : "fill-[#1baf7a] dark:fill-[#199e70]"} />}
                {r !== null && <text x={x} y={yRate(Math.max(0, r)) - 3} textAnchor="middle" fontSize={9} className="fill-slate-500">{Math.round(r * 100)}</text>}
                <text x={x} y={H - 6} textAnchor="middle" fontSize={10} className="fill-slate-500">{short(p.month)}</text>
              </g>
            );
          })}
        </svg>
        <p className="text-xs text-slate-500">Part des revenus non dépensée chaque mois, en %. Un mois sans revenu saisi n'a pas de barre.</p>
      </div>
    </div>
  );
}
