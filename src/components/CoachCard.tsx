import { Link } from "react-router-dom";
import { useRefreshAdvice, useWeeklyAdvice } from "@/lib/queries";
import type { Insight } from "@shared/types";

const ICON: Record<Insight["severity"], string> = { warning: "⚠️", info: "💡", good: "🎉" };

export function CoachCard() {
  const { data } = useWeeklyAdvice();
  const refresh = useRefreshAdvice();
  if (!data) return null;
  return (
    <section className="card space-y-3 border border-brand/20">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">🧭 Conseil de la semaine</h2>
        <button className="text-xs text-slate-500" onClick={() => refresh.mutate()} disabled={refresh.isPending} aria-label="Recalculer">{refresh.isPending ? "…" : "↻"}</button>
      </div>
      <p className="text-sm leading-relaxed">{data.message}</p>
      {data.insights.length > 0 && (
        <ul className="space-y-1.5">
          {data.insights.slice(0, 3).map((i, idx) => (
            <li key={idx} className="text-sm">
              {i.link ? (
                <Link to={i.link} className="flex gap-2"><span>{ICON[i.severity]}</span><span><span className="font-medium">{i.title}.</span> <span className="text-slate-500">{i.text}</span></span></Link>
              ) : (
                <span className="flex gap-2"><span>{ICON[i.severity]}</span><span><span className="font-medium">{i.title}.</span> <span className="text-slate-500">{i.text}</span></span></span>
              )}
            </li>
          ))}
        </ul>
      )}
      <Link to="/coach" className="btn-ghost w-full text-sm">💬 Poser une question sur mes chiffres</Link>
    </section>
  );
}
