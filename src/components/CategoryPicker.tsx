import { useMemo } from "react";
import type { Category, TxType } from "@shared/types";

/** Grille de catégories : les parents en gros, les sous-catégories en puces. Une seule action : taper. */
export function CategoryPicker({ categories, type, value, onChange }: { categories: Category[]; type: TxType; value: number | null; onChange: (id: number) => void }) {
  const kind = type === "income" ? "income" : "expense";
  const parents = useMemo(() => categories.filter((c) => !c.parentId && c.kind === kind), [categories, kind]);
  const children = useMemo(() => categories.filter((c) => c.parentId), [categories]);
  const selected = categories.find((c) => c.id === value);
  const openParent = selected ? (selected.parentId ?? selected.id) : null;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        {parents.map((p) => {
          const active = openParent === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onChange(p.id)}
              className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-sm font-medium ${active ? "border-brand bg-brand/10" : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"}`}
            >
              <span className="text-2xl">{p.icon ?? "•"}</span>
              <span className="leading-tight">{p.name}</span>
            </button>
          );
        })}
      </div>
      {openParent && (
        <div className="flex flex-wrap gap-2">
          {children.filter((c) => c.parentId === openParent).map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onChange(c.id)}
              className={`chip ${value === c.id ? "bg-brand text-white" : "bg-slate-100 dark:bg-slate-800"}`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
