import { Link } from "react-router-dom";
import { IconChat } from "./icons";
import { useRefreshAdvice, useWeeklyAdvice } from "@/lib/queries";
import type { Insight } from "@shared/types";

const ICON: Record<Insight["severity"], string> = { warning: "⚠️", info: "💡", good: "🎉" };

/** Sur l'Accueil : un seul bouton vers le coach. */
export function CoachButton() {
  return (
    <Link to="/coach" className="card flex h-13 items-center gap-2.5 p-0 px-4 font-semibold text-brand" style={{ height: 52 }}>
      <IconChat size={20} />
      <span className="truncate">Poser une question</span>
    </Link>
  );
}

/** Dans la page du coach : le conseil de la semaine et ses constats. */
export function WeeklyAdvicePanel() {
  const { data } = useWeeklyAdvice();
  const refresh = useRefreshAdvice();
  if (!data) return null;
  return (
    <section className="card space-y-3 border border-brand/20">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">🧭 Conseil de la semaine</h2>
        <button className="-my-2 -mr-2 flex size-11 items-center justify-center text-slate-500" onClick={() => refresh.mutate()} disabled={refresh.isPending} aria-label="Recalculer le conseil">{refresh.isPending ? "…" : "↻"}</button>
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
    </section>
  );
}
