import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { IconChart, IconFlag, IconHouse, IconPlus, IconReceipt, IconTarget } from "./icons";

const tabs = [
  { to: "/", label: "Accueil", Icon: IconHouse },
  { to: "/transactions", label: "Transactions", Icon: IconReceipt },
  { to: "/budgets", label: "Budgets", Icon: IconTarget },
  { to: "/projets", label: "Projets", Icon: IconFlag },
  { to: "/suivi", label: "Suivi", Icon: IconChart },
];

export function Layout() {
  const navigate = useNavigate();
  return (
    <div className="mx-auto flex min-h-full max-w-lg flex-col">
      <main className="flex-1 px-4 pb-24 pt-4">
        <Outlet />
      </main>
      {/* Le bouton + est dans la barre : flottant au-dessus, il recouvrait des lignes cliquables. */}
      <nav className="fixed bottom-0 left-0 right-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <div className="mx-auto grid max-w-lg grid-cols-6 items-center pb-[env(safe-area-inset-bottom)]">
          {tabs.slice(0, 3).map((t) => <Tab key={t.to} {...t} />)}
          <button onClick={() => navigate("/ajouter")} aria-label="Ajouter une transaction" className="flex h-[62px] items-center justify-center">
            <span className="flex size-[50px] items-center justify-center rounded-2xl bg-brand text-white shadow-sm transition active:scale-95">
              <IconPlus size={24} />
            </span>
          </button>
          {tabs.slice(3).map((t) => <Tab key={t.to} {...t} />)}
        </div>
      </nav>
    </div>
  );
}

function Tab({ to, label, Icon }: { to: string; label: string; Icon: (p: { size?: number }) => JSX.Element }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        `flex h-[62px] flex-col items-center justify-center gap-1 px-0.5 text-[10px] leading-tight ${isActive ? "font-semibold text-brand" : "text-slate-500"}`
      }
    >
      <Icon size={21} />
      <span className="truncate">{label}</span>
    </NavLink>
  );
}
