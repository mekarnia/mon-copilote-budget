import { useEffect, useState, type ReactNode } from "react";
import { formatCents, parseEuros } from "@shared/money";

export function Money({ cents, className = "", signed = false }: { cents: number; signed?: boolean; className?: string }) {
  const sign = signed ? (cents > 0 ? "+" : "") : "";
  return <span className={`tabular-nums ${className}`}>{sign}{formatCents(cents)}</span>;
}

/** Saisie d'un montant en euros, valeur exposée en centimes. Clavier numérique sur mobile. */
export function MoneyInput({ value, onChange, autoFocus, placeholder = "0,00" }: { value: number | null; onChange: (cents: number | null) => void; autoFocus?: boolean; placeholder?: string }) {
  const [text, setText] = useState(value === null ? "" : (value / 100).toFixed(2).replace(".", ","));
  useEffect(() => {
    if (value === null && text !== "" && parseEuros(text) !== null) setText("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className="relative">
      <input
        inputMode="decimal"
        autoFocus={autoFocus}
        className="input pr-10 text-3xl font-bold"
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(parseEuros(e.target.value));
        }}
      />
      <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-2xl text-slate-400">€</span>
    </div>
  );
}

export function ProgressBar({ ratio, status }: { ratio: number; status: "green" | "orange" | "red" | "none" }) {
  const color = { green: "bg-emerald-500", orange: "bg-amber-500", red: "bg-red-500", none: "bg-slate-300 dark:bg-slate-700" }[status];
  return (
    <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
      <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }} />
    </div>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-slate-50 p-4 pb-8 shadow-xl dark:bg-slate-950 sm:max-w-lg sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">{title}</h2>
          <button className="rounded-full p-2 text-2xl leading-none text-slate-500" onClick={onClose} aria-label="Fermer">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Empty({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="card flex flex-col items-center gap-2 py-8 text-center text-slate-500">
      <span className="text-4xl">{icon}</span>
      <p>{text}</p>
    </div>
  );
}

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{(error as Error).message}</p>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="grid gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-lg py-2 text-sm font-semibold transition ${value === o.value ? "bg-white shadow dark:bg-slate-900" : "text-slate-500"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function MonthNav({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const [y, m] = month.split("-").map(Number);
  const label = new Date(y, m - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const shift = (d: number) => {
    const dt = new Date(y, m - 1 + d, 1);
    onChange(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`);
  };
  return (
    <div className="flex items-center justify-between">
      <button className="btn-ghost px-3 py-2" onClick={() => shift(-1)} aria-label="Mois précédent">‹</button>
      <span className="text-lg font-semibold capitalize">{label}</span>
      <button className="btn-ghost px-3 py-2" onClick={() => shift(1)} aria-label="Mois suivant">›</button>
    </div>
  );
}
