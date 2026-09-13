import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { PageHeader, Segmented } from "@/components/ui";
import { formatCents } from "@shared/money";
import { monthLabel } from "@shared/dates";

export const VIEWS = [
  { key: "depenses", label: "Dépenses", icon: "📉" },
  { key: "revenus", label: "Revenus", icon: "📈" },
  { key: "evitables", label: "Évitables", icon: "✂️" },
] as const;
type ViewKey = (typeof VIEWS)[number]["key"];
export type PeriodKey = "7d" | "1m" | "6m" | "1y";
export const PERIODS: { value: PeriodKey; label: string }[] = [
  { value: "7d", label: "7 J" }, { value: "1m", label: "1 M" }, { value: "6m", label: "6 M" }, { value: "1y", label: "1 A" },
];

interface Point { label: string; date: string; value: number; cumulative: number }
interface Cat { categoryId: number; name: string; icon: string | null; total: number; share: number }
interface Range { key: PeriodKey; from: string; to: string; prevFrom: string; prevTo: string; granularity: "day" | "month"; days: number }
interface PeriodStats { type: "expense" | "income"; range: Range; total: number; previousTotal: number; deltaPct: number | null; perDay: number; points: Point[]; previousPoints: Point[]; byCategory: Cat[] }
interface Goal { target: number; saving: number; projectName: string | null; reason: string; actions: string[]; generatedBy: "ai" | "template" }
interface AvoidableStats extends PeriodStats { allExpenses: number; shareOfExpenses: number; goal: Goal | null; avoidableIds: number[] }

const frDate = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }); };
const shortMonth = (m: string) => { const [y, mo] = m.split("-").map(Number); return new Date(y, mo - 1, 1).toLocaleDateString("fr-FR", { month: "short" }).replace(".", ""); };
const rangeLabel = (r: Range) => (r.granularity === "day" ? `Du ${frDate(r.from)} au ${frDate(r.to)}` : `De ${monthLabel(r.from.slice(0, 7))} à ${monthLabel(r.to.slice(0, 7))}`);
const pct = (v: number | null) => (v === null ? null : `${v > 0 ? "+" : ""}${Math.round(v * 100)} %`);

export function SuiviPage() {
  const [params, setParams] = useSearchParams();
  const view = (VIEWS.some((v) => v.key === params.get("vue")) ? params.get("vue") : "depenses") as ViewKey;
  const period = (PERIODS.some((p) => p.value === params.get("p")) ? params.get("p") : "1m") as PeriodKey;
  const set = (patch: Record<string, string>) => setParams({ vue: view, p: period, ...patch });

  return (
    <div className="space-y-4">
      <PageHeader title="Suivi" />
      <div className="scroll-row -mx-4 px-4">
        {VIEWS.map((v) => (
          <button key={v.key} className={`chip shrink-0 ${view === v.key ? "bg-brand text-white" : "bg-slate-100 dark:bg-slate-800"}`} onClick={() => set({ vue: v.key })}>{v.label}</button>
        ))}
      </div>
      {view === "depenses" && <PeriodIndicator type="expense" period={period} onPeriod={(p) => set({ p })} />}
      {view === "revenus" && <PeriodIndicator type="income" period={period} onPeriod={(p) => set({ p })} />}
      {view === "evitables" && <AvoidableIndicator period={period} onPeriod={(p) => set({ p })} />}
    </div>
  );
}

/* ---------- Dépenses (courbe cumulée) et Revenus (barres) ---------- */
function PeriodIndicator({ type, period, onPeriod }: { type: "expense" | "income"; period: PeriodKey; onPeriod: (p: PeriodKey) => void }) {
  const { data } = useQuery({ queryKey: ["periodStats", type, period], queryFn: () => api.get<PeriodStats>(`/api/stats/period?type=${type}&period=${period}`), placeholderData: (prev) => prev });
  if (!data) return <p className="text-slate-500">Chargement…</p>;
  const isExpense = type === "expense";
  const delta = pct(data.deltaPct);
  const good = data.deltaPct === null ? null : isExpense ? data.deltaPct <= 0 : data.deltaPct >= 0;
  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div>
          <h2 className="font-semibold">{isExpense ? "Rythme des dépenses" : "Suivi des revenus"}</h2>
          <p className="text-xs text-slate-500">{rangeLabel(data.range)}</p>
        </div>
        <Segmented value={period} onChange={onPeriod} options={PERIODS} />
        <div>
          <p className="text-3xl font-bold tabular-nums whitespace-nowrap">{formatCents(data.total)}</p>
          <p className="text-sm text-slate-500">
            {data.range.granularity === "day" ? `${formatCents(data.perDay)} par jour` : `${formatCents(Math.round(data.total / Math.max(1, data.points.length)))} par mois`}
            {delta && <> · <span className={`font-semibold ${good ? "text-emerald-600" : "text-red-600"}`}>{delta} vs période précédente</span></>}
          </p>
        </div>
        {isExpense ? <CumulativeCurve points={data.points} previous={data.previousPoints} /> : <Bars points={data.points} color="fill-[#1baf7a] dark:fill-[#199e70]" />}
        <p className="text-xs text-slate-500">
          {isExpense ? "Cumul depuis le début de la période, la période précédente en pointillé." : "Total de chaque jour ou de chaque mois selon la période."}
        </p>
      </div>
      <CategoryList cats={data.byCategory} type={type} period={period} />
    </div>
  );
}

/* ---------- Dépenses évitables ---------- */
function AvoidableIndicator({ period, onPeriod }: { period: PeriodKey; onPeriod: (p: PeriodKey) => void }) {
  const { data, error } = useQuery({ queryKey: ["avoidable", period], queryFn: () => api.get<AvoidableStats>(`/api/stats/avoidable?period=${period}`), placeholderData: (prev) => prev });
  // L'objectif rédigé arrive séparément : les chiffres n'attendent pas l'IA.
  const aiGoal = useQuery({ queryKey: ["avoidableGoal", period, data?.total], queryFn: () => api.get<{ goal: Goal | null }>(`/api/stats/avoidable/goal?period=${period}`), enabled: !!data && !!data.goal, staleTime: 5 * 60_000 });
  if (error) return <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{(error as Error).message}</p>;
  if (!data) return <p className="text-slate-500">Chargement…</p>;
  const goal = aiGoal.data?.goal ?? data.goal;
  const delta = pct(data.deltaPct);
  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div>
          <h2 className="font-semibold">Dépenses évitables</h2>
          <p className="text-xs text-slate-500">{data.byCategory.length ? data.byCategory.map((c) => c.name).join(", ") + " · " : ""}{rangeLabel(data.range)}</p>
        </div>
        <Segmented value={period} onChange={onPeriod} options={PERIODS} />
        <div>
          <p className="text-3xl font-bold tabular-nums whitespace-nowrap">{formatCents(data.total)}</p>
          <p className="text-sm text-slate-500">
            {Math.round(data.shareOfExpenses * 100)} % des dépenses
            {delta && <> · <span className={`font-semibold ${data.deltaPct! <= 0 ? "text-emerald-600" : "text-red-600"}`}>{delta} vs période précédente</span></>}
          </p>
        </div>
        {data.avoidableIds.length === 0 ? (
          <p className="rounded-xl bg-slate-100 px-3 py-2 text-sm dark:bg-slate-800">Aucune catégorie n'est marquée « évitable ». Choisissez-les dans <Link to="/reglages/categories" className="font-semibold">Réglages → Catégories</Link>.</p>
        ) : (
          <Bars points={data.points} color="fill-[#eb6834] dark:fill-[#d95926]" />
        )}
        {goal && (
          <div className="space-y-1.5 rounded-xl bg-orange-50 px-3 py-2 text-sm text-orange-900 dark:bg-orange-950 dark:text-orange-200">
            <p className="font-semibold">🎯 Objectif du coach : passer sous {formatCents(goal.target)}, soit {formatCents(goal.saving)} de plus{goal.projectName ? ` pour ${goal.projectName}` : " à mettre de côté"}.</p>
            <p>{goal.reason}</p>
            {goal.actions.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-5">
                {goal.actions.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            )}
            <p className="text-xs opacity-70">
              {aiGoal.isFetching && !aiGoal.data ? "Le coach rédige son conseil…" : goal.generatedBy === "ai" ? "Rédigé par l'IA d'après vos transactions." : "Calculé d'après vos transactions. Ajoutez une clé IA pour des conseils rédigés."}
            </p>
          </div>
        )}
      </div>
      <CategoryList cats={data.byCategory} type="expense" period={period} />
      <p className="text-xs text-slate-500">Les catégories comptées comme évitables se choisissent dans <Link to="/reglages/categories" className="font-semibold text-brand">Réglages → Catégories</Link>.</p>
    </div>
  );
}

/* ---------- Composants ---------- */
function CategoryList({ cats, type, period }: { cats: Cat[]; type: "expense" | "income"; period: PeriodKey }) {
  const max = Math.max(1, ...cats.map((c) => c.total));
  return (
    <div className="card space-y-3">
      <h2 className="font-semibold">Par catégorie sur la période</h2>
      {cats.length === 0 && <p className="text-sm text-slate-500">Rien sur cette période.</p>}
      {cats.map((c) => (
        <Link key={c.categoryId} to={`/suivi/categorie/${c.categoryId}?type=${type}&p=${period}`} className="block space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span>{c.icon} {c.name}</span>
            <span className="flex items-center gap-2"><span className="font-semibold tabular-nums">{formatCents(c.total)}</span><span className="text-xs text-slate-500">{Math.round(c.share * 100)} %</span><span className="text-slate-400">›</span></span>
          </div>
          <div className="h-2.5 rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-slate-300 dark:bg-slate-600" style={{ width: `${Math.max(2, (c.total / max) * 100)}%` }} /></div>
        </Link>
      ))}
      {cats.length > 0 && <p className="text-xs text-slate-500">Touchez une catégorie pour voir ses transactions sur la période.</p>}
    </div>
  );
}

function axisLabels(points: Point[]): { i: number; text: string }[] {
  if (points.length === 0) return [];
  if (points[0].label.length === 7) return points.map((p, i) => ({ i, text: shortMonth(p.label) }));
  const n = points.length;
  const idx = n <= 7 ? points.map((_, i) => i) : [0, Math.round(n / 4), Math.round(n / 2), Math.round((3 * n) / 4), n - 1];
  return idx.map((i) => ({ i, text: i === 0 || i === n - 1 ? frDate(points[i].date) : points[i].label.replace(/^0/, "") }));
}

function CumulativeCurve({ points, previous }: { points: Point[]; previous: Point[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 360, H = 130, padB = 18;
  const n = Math.max(points.length, 2);
  const max = Math.max(1, points[points.length - 1]?.cumulative ?? 0, previous[previous.length - 1]?.cumulative ?? 0);
  const x = (i: number) => (i / (n - 1)) * W;
  const y = (v: number) => H - padB - (v / max) * (H - padB - 10);
  const path = (pts: Point[]) => pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.cumulative).toFixed(1)}`).join(" ");
  const labels = axisLabels(points);
  const sel = hover !== null ? points[hover] : null;
  return (
    <div className="space-y-1">
      <div className="h-5 text-xs text-slate-600 dark:text-slate-300">
        {sel ? <>{sel.label.length === 7 ? monthLabel(sel.label) : frDate(sel.date)} : <b>{formatCents(sel.cumulative)}</b> cumulés{sel.value > 0 && ` (+${formatCents(sel.value)})`}</> : <span className="text-slate-400">Touchez la courbe pour lire une valeur.</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Dépenses cumulées" onMouseLeave={() => setHover(null)}>
        <line x1={0} x2={W} y1={y(0)} y2={y(0)} className="stroke-slate-300 dark:stroke-slate-600" strokeWidth={1} />
        <line x1={0} x2={W} y1={y(max / 2)} y2={y(max / 2)} className="stroke-slate-200 dark:stroke-slate-700" strokeWidth={1} />
        {points.length > 1 && <path d={`${path(points)} L${x(points.length - 1).toFixed(1)} ${y(0)} L0 ${y(0)} Z`} className="fill-[#2a78d6] dark:fill-[#3987e5]" opacity={0.08} />}
        {previous.length > 1 && <path d={path(previous)} fill="none" className="stroke-slate-400" strokeWidth={2} strokeDasharray="4 4" strokeLinecap="round" />}
        {points.length > 1 && <path d={path(points)} fill="none" className="stroke-[#2a78d6] dark:stroke-[#3987e5]" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />}
        {points.map((p, i) => (
          <rect key={i} x={x(i) - W / n / 2} y={0} width={W / n} height={H - padB} fill="transparent" onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)} onClick={() => setHover(i)} />
        ))}
        {points.length > 0 && <circle cx={x(sel ? hover! : points.length - 1)} cy={y((sel ?? points[points.length - 1]).cumulative)} r={5} className="fill-[#2a78d6] dark:fill-[#3987e5]" stroke="white" strokeWidth={2} />}
        {labels.map((l) => <text key={l.i} x={x(l.i)} y={H - 4} textAnchor={l.i === 0 ? "start" : l.i === points.length - 1 ? "end" : "middle"} fontSize={10} className="fill-slate-500">{l.text}</text>)}
      </svg>
      <div className="flex gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1.5"><i className="inline-block h-0.5 w-3.5 rounded bg-[#2a78d6]" />Cette période</span>
        <span className="flex items-center gap-1.5"><i className="inline-block w-3.5 border-t-2 border-dashed border-slate-400" />Période précédente</span>
      </div>
    </div>
  );
}

function Bars({ points, color }: { points: Point[]; color: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 360, H = 140, padB = 18, padT = 14;
  const n = Math.max(points.length, 1);
  const max = Math.max(1, ...points.map((p) => p.value));
  const slot = W / n, bw = Math.max(3, Math.min(40, slot * 0.6));
  const y = (v: number) => padT + (H - padB - padT) - (v / max) * (H - padB - padT);
  const labels = axisLabels(points);
  const monthly = points[0]?.label.length === 7;
  const sel = hover !== null ? points[hover] : null;
  return (
    <div className="space-y-1">
      {!monthly && <div className="h-5 text-xs text-slate-600 dark:text-slate-300">{sel ? <>{frDate(sel.date)} : <b>{formatCents(sel.value)}</b></> : <span className="text-slate-400">Touchez une barre pour lire une valeur.</span>}</div>}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Montants par période" onMouseLeave={() => setHover(null)}>
        <line x1={0} x2={W} y1={y(0)} y2={y(0)} className="stroke-slate-300 dark:stroke-slate-600" strokeWidth={1} />
        {points.map((p, i) => {
          const bx = i * slot + (slot - bw) / 2;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)} onClick={() => setHover(i)}>
              <rect x={i * slot} y={0} width={slot} height={H - padB} fill="transparent" />
              {p.value > 0 && <rect x={bx} y={y(p.value)} width={bw} height={y(0) - y(p.value)} rx={2} className={color} opacity={hover === null || hover === i ? 1 : 0.5} />}
              {monthly && p.value > 0 && <text x={bx + bw / 2} y={y(p.value) - 3} textAnchor="middle" fontSize={10} fontWeight={600} className="fill-slate-700 dark:fill-slate-200">{formatCents(p.value).replace(/,\d\d/, "")}</text>}
            </g>
          );
        })}
        {labels.map((l) => <text key={l.i} x={l.i * slot + slot / 2} y={H - 4} textAnchor="middle" fontSize={10} className="fill-slate-500">{l.text}</text>)}
      </svg>
    </div>
  );
}
