import { Link } from "react-router-dom";
import { useHome, useToVerifyCount } from "@/lib/queries";
import { Money, ProgressBar, Empty, Bandeau, BandeauStat } from "@/components/ui";
import { CategoryBadge, IconBars, IconGear, IconWarning, categoryLook } from "@/components/icons";
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

  const remainingColor = data.remaining < 0 ? "text-red-200" : data.remaining < data.income * 0.1 ? "text-amber-200" : "text-white";
  const maxCat = data.byCategory[0]?.total ?? 1;

  return (
    <div className="space-y-4">
      <Bandeau>
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold capitalize text-white/80">{monthLabel(month)}</p>
          <div className="-mr-2 flex">
            <Link to="/suivi?vue=depenses&p=1m" className="flex size-11 items-center justify-center text-white/80" aria-label="Statistiques"><IconBars size={21} /></Link>
            <Link to="/reglages" className="flex size-11 items-center justify-center text-white/80" aria-label="Réglages"><IconGear size={21} /></Link>
          </div>
        </div>
        <div>
          <p className="text-[13px] text-white/75">Il vous reste à dépenser</p>
          <p className={`font-bold tabular-nums ${tailleDuMontant(data.remaining)} ${remainingColor}`}><Money cents={data.remaining} /></p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <BandeauStat label="Entré" value={<Money cents={data.income} short />} />
          <BandeauStat label="Sorti" value={<Money cents={data.expense} short />} />
          <BandeauStat label="À venir" value={<Money cents={data.upcomingExpense} short />} />
        </div>
      </Bandeau>

      {(toVerify?.count ?? 0) > 0 && (
        <Link to="/verifier" className="flex min-h-12 items-center rounded-2xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <span className="flex items-center gap-2"><IconWarning size={19} /><span className="flex-1">{toVerify!.count} transaction{toVerify!.count > 1 ? "s" : ""} à vérifier</span><span className="font-semibold">Vérifier</span></span>
        </Link>
      )}
      {data.redBudgets.length > 0 && (
        <Link to="/budgets" className="flex min-h-12 items-center rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
          Budget dépassé : {data.redBudgets.map((b) => b.categoryName).join(", ")}
        </Link>
      )}

      <CoachButton />

      {data.byCategory.length === 0 ? (
        <section className="card"><p className="text-sm text-slate-500">Aucune dépense ce mois-ci. Appuyez sur + pour commencer.</p></section>
      ) : (
        <section className="space-y-2">
          <h2 className="font-semibold">Où part l'argent</h2>
          {data.byCategory.slice(0, 5).map((c) => {
            const look = categoryLook(c.name);
            return (
              <Link key={c.categoryId} to={`/transactions?categoryId=${c.categoryId}&all=1`} className="card flex h-[60px] items-center gap-3 p-0 px-3.5">
                <CategoryBadge name={c.name} />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="truncate text-[15px] font-semibold">{c.name}</p>
                  <div className="h-1 rounded-full bg-slate-200 dark:bg-slate-800">
                    <div className={`h-1 rounded-full ${look.bar}`} style={{ width: `${Math.max(2, Math.round((c.total / maxCat) * 100))}%` }} />
                  </div>
                </div>
                <Money cents={c.total} className="text-[15px] font-bold" />
              </Link>
            );
          })}
        </section>
      )}

      <section className="card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Mes projets</h2>
          <Link to="/projets" className="-my-2 flex h-11 items-center px-2 text-sm font-medium text-brand">Voir tout</Link>
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
