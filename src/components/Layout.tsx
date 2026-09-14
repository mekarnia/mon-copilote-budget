import { NavLink, Outlet, useNavigate } from "react-router-dom";

const tabs = [
  { to: "/", label: "Accueil", icon: "🏠" },
  { to: "/transactions", label: "Transactions", icon: "📋" },
  { to: "/budgets", label: "Budgets", icon: "🎯" },
  { to: "/projets", label: "Projets", icon: "🚀" },
  { to: "/suivi", label: "Suivi", icon: "📈" },
];

export function Layout() {
  const navigate = useNavigate();
  return (
    <div className="mx-auto flex min-h-full max-w-lg flex-col">
      <main className="flex-1 px-4 pb-28 pt-4">
        <Outlet />
      </main>
      <button
        onClick={() => navigate("/ajouter")}
        aria-label="Ajouter une transaction"
        className="fixed bottom-20 left-1/2 z-30 flex h-16 w-16 -translate-x-1/2 items-center justify-center rounded-full bg-brand text-4xl font-light text-white shadow-lg active:scale-95"
      >
        +
      </button>
      <nav className="fixed bottom-0 left-0 right-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <div className="mx-auto grid max-w-lg grid-cols-5 pb-[env(safe-area-inset-bottom)]">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.to === "/"}
              className={({ isActive }) => `flex flex-col items-center gap-0.5 py-2 text-xs ${isActive ? "text-brand font-semibold" : "text-slate-500"}`}
            >
              <span className="text-xl">{t.icon}</span>
              {t.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
