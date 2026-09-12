import { Link } from "react-router-dom";
import { useHome, useToVerifyCount } from "@/lib/queries";
import { Money, ProgressBar, Empty } from "@/components/ui";
import { CoachCard } from "@/components/CoachCard";
import { currentMonth, dayLabel, monthLabel } from "@shared/dates";

export function HomePage() {
  const month = currentMonth();
  const { data, isLoading, error } = useHome(month);
  const { data: toVerify } = useToVerifyCount();

  if (isLoading) return <p className="text-slate-500">Chargement…</p>;
  if (error || !data) return <div className="card space-y-2 text-sm">
      <p className="font-semibold text-red-600">Le serveur de l'application ne répond pas.</p>
      <p className="text-slate-500">Dans PowerShell, dans le dossier du projet, lancez <code>npm.cmd run dev</code> et attendez la ligne « API sur http://localhost:3001 », puis rechargez cette page.</p>
      <button className="btn-ghost w-full" onClick={() => window.location.reload()}>Réessayer</button>
    </div>;

  const remainingColor = data.remaining < 0 ? "text-red-600" : data.remaining < data.income * 0.1 ? "text-amber-600" : "text-emerald-600";
  const maxCat = data.byCategory[0]?.total ?? 1;

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-500 capitalize">{monthLabel(month)}</p>
          <h1 className="text-2xl font-bold">Mon budget</h1>
        </div>
        <Link to="/reglages" className="btn-ghost px-3 py-2" aria-label="Réglages">⚙️</Link>
      </header>

      <section className="card text-center">
        <p className="text-sm text-slate-500">Reste à dépenser ce mois-ci</p>
        <p className={`my-1 text-5xl font-bold ${remainingColor}`}><Money cents={data.remaining} /></p>
        <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
          <div><p className="text-slate-500">Revenus</p><p className="font-semibold text-emerald-600"><Money cents={data.income} /></p></div>
          <div><p className="text-slate-500">Dépensé</p><p className="font-semibold"><Money cents={data.expense} /></p></div>
          <div><p className="text-slate-500">À venir</p><p className="font-semibold text-amber-600"><Money cents={data.upcomingExpense} /></p></div>
        </div>
      </section>

      {(toVerify?.count ?? 0) > 0 && (
        <Link to="/operations" className="block rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          ⚠️ {toVerify!.count} opération{toVerify!.count > 1 ? "s" : ""} importée{toVerify!.count > 1 ? "s" : ""} à vérifier
        </Link>
      )}
      {data.redBudgets.length > 0 && (
        <Link to="/budgets" className="block rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          🔴 Budget dépassé : {data.redBudgets.map((b) => b.categoryName).join(", ")}
        </Link>
      )}

      <CoachCard />

      <section className="card space-y-3">
        {data.byCategory.length === 0 ? (
          <p className="text-sm text-slate-500">Aucune dépense ce mois-ci. Appuyez sur + pour commencer.</p>
        ) : (
          data.byCategory.slice(0, 5).map((c) => (
            <Link key={c.categoryId} to={`/operations?categoryId=${c.categoryId}&all=1`} className="block">
              <div className="mb-1 flex justify-between text-sm">
                <span>{c.icon} {c.name}</span>
                <span><Money cents={c.total} className="font-semibold" /> <span className="text-slate-400">›</span></span>
              </div>
              <ProgressBar ratio={c.total / maxCat} status="none" />
            </Link>
          ))
        )}
      </section>

      {data.upcoming.length > 0 && (
        <section className="card space-y-2">
          <h2 className="font-semibold">Prochaines factures (7 jours)</h2>
          {data.upcoming.map((b, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span><span className="text-slate-500">{dayLabel(b.date)}</span> · {b.label}</span>
              <Money cents={b.type === "income" ? b.amount : -b.amount} signed className={b.type === "income" ? "text-emerald-600" : ""} />
            </div>
          ))}
        </section>
      )}

      <section className="card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Mes projets</h2>
          <Link to="/projets" className="text-sm text-brand">Voir tout</Link>
        </div>
        {data.projects.length === 0 ? (
          <p className="text-sm text-slate-500">Aucun projet en cours.</p>
        ) : (
          data.projects.slice(0, 3).map((p) => (
            <div key={p.id}>
              <div className="mb-1 flex justify-between text-sm">
                <span>{p.name}</span>
                <span className="text-slate-500"><Money cents={p.saved} /> / <Money cents={p.target} /></span>
              </div>
              <ProgressBar ratio={p.ratio} status="green" />
            </div>
          ))
        )}
      </section>

      <p className="text-center text-sm text-slate-500">Total de mes portefeuilles : <Money cents={data.walletsTotal} className="font-semibold" /></p>
      {data.income === 0 && data.expense === 0 && <Empty icon="👋" text="Bienvenue ! Commencez par régler vos portefeuilles et votre salaire dans Réglages." />}
    </div>
  );
}
