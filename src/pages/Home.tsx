import { Link } from "react-router-dom";
import { useHome, useToVerifyCount } from "@/lib/queries";
import { Money, ProgressBar, Empty } from "@/components/ui";
import { CoachButton } from "@/components/CoachCard";
import { currentMonth, monthLabel } from "@shared/dates";
import { formatCents } from "@shared/money";

/**
 * Les montants en dinars sont deux à trois chiffres plus longs qu'en euros :
 * à taille fixe, « 1 200 000,00 DA » déborde de l'écran du téléphone.
 */
function tailleDuMontant(cents: number): string {
  const n = formatCents(cents).length;
  if (n > 16) return "text-2xl";
  if (n > 13) return "text-3xl";
  if (n > 10) return "text-4xl";
  return "text-5xl";
}

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
        <div className="flex gap-2">
          <Link to="/suivi?vue=depenses&p=1m" className="btn-ghost px-3 py-2" aria-label="Statistiques">📊</Link>
          <Link to="/reglages" className="btn-ghost px-3 py-2" aria-label="Réglages">⚙️</Link>
        </div>
      </header>

      <section className="card text-center">
        <p className="text-sm text-slate-500">Reste à dépenser ce mois-ci</p>
        <p className={`my-1 font-bold ${tailleDuMontant(data.remaining)} ${remainingColor}`}><Money cents={data.remaining} /></p>
        <div className="mt-3 grid grid-cols-3 gap-x-3 text-center text-sm">
          <div className="min-w-0"><p className="text-slate-500">Revenus</p><p className="break-words text-xs font-semibold text-emerald-600 sm:text-sm"><Money cents={data.income} /></p></div>
          <div className="min-w-0"><p className="text-slate-500">Dépensé</p><p className="break-words text-xs font-semibold sm:text-sm"><Money cents={data.expense} /></p></div>
          <div className="min-w-0"><p className="text-slate-500">À venir</p><p className="break-words text-xs font-semibold text-amber-600 sm:text-sm"><Money cents={data.upcomingExpense} /></p></div>
        </div>
      </section>

      {(toVerify?.count ?? 0) > 0 && (
        <Link to="/verifier" className="block rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          ⚠️ {toVerify!.count} transaction{toVerify!.count > 1 ? "s" : ""} importée{toVerify!.count > 1 ? "s" : ""} à vérifier <span className="font-semibold underline">Vérifier</span>
        </Link>
      )}
      {data.redBudgets.length > 0 && (
        <Link to="/budgets" className="block rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          🔴 Budget dépassé : {data.redBudgets.map((b) => b.categoryName).join(", ")}
        </Link>
      )}

      <CoachButton />

      <section className="card space-y-3">
        {data.byCategory.length === 0 ? (
          <p className="text-sm text-slate-500">Aucune dépense ce mois-ci. Appuyez sur + pour commencer.</p>
        ) : (
          data.byCategory.slice(0, 5).map((c) => (
            <Link key={c.categoryId} to={`/transactions?categoryId=${c.categoryId}&all=1`} className="block">
              <div className="mb-1 flex justify-between text-sm">
                <span>{c.icon} {c.name}</span>
                <span><Money cents={c.total} className="font-semibold" /> <span className="text-slate-400">›</span></span>
              </div>
              <ProgressBar ratio={c.total / maxCat} status="none" />
            </Link>
          ))
        )}
      </section>

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
