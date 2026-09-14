import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useBulkTransactions, useCategories, useTransactions } from "@/lib/queries";
import { CategoryPicker } from "@/components/CategoryPicker";
import { Money, Empty, ErrorBanner, PageHeader, Sheet } from "@/components/ui";
import type { Category, Transaction, TxType } from "@shared/types";

interface Group {
  key: number;
  icon: string;
  title: string;
  type: TxType;
  items: Transaction[];
  total: number;
}

/** Regroupe les lignes à vérifier par catégorie : on valide un groupe entier plutôt que ligne à ligne. */
function groupByCategory(rows: Transaction[], categories: Category[]): Group[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const groups = new Map<number, Group>();
  for (const t of rows) {
    const key = t.categoryId ?? 0;
    let g = groups.get(key);
    if (!g) {
      const cat = t.categoryId ? byId.get(t.categoryId) : undefined;
      const parent = cat?.parentId ? byId.get(cat.parentId) : undefined;
      g = {
        key,
        icon: parent?.icon ?? cat?.icon ?? "•",
        title: cat ? (parent ? `${parent.name} › ${cat.name}` : cat.name) : "Sans catégorie",
        type: t.type,
        items: [],
        total: 0,
      };
      groups.set(key, g);
    }
    g.items.push(t);
    g.total += t.type === "income" ? t.amount : -t.amount;
  }
  return [...groups.values()].sort((a, b) => b.items.length - a.items.length);
}

export function VerifierPage() {
  const { data: rows = [], isLoading } = useTransactions(null, "", "to_verify");
  const { data: categories = [] } = useCategories();
  const bulk = useBulkTransactions();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [picker, setPicker] = useState<{ ids: number[]; type: TxType } | null>(null);

  const groups = useMemo(() => groupByCategory(rows, categories), [rows, categories]);
  const ids = [...selected];

  function toggle(id: number) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleGroup(g: Group) {
    const all = g.items.every((t) => selected.has(t.id));
    setSelected((s) => {
      const next = new Set(s);
      for (const t of g.items) { if (all) next.delete(t.id); else next.add(t.id); }
      return next;
    });
  }

  async function run(action: "confirm" | "delete", targets: number[]) {
    if (targets.length === 0) return;
    await bulk.mutateAsync({ ids: targets, action, categoryId: null });
    setSelected(new Set());
  }

  async function reclasser(categoryId: number) {
    if (!picker) return;
    await bulk.mutateAsync({ ids: picker.ids, action: "recategorize", categoryId });
    setPicker(null);
    setSelected(new Set());
  }

  function ouvrirPicker(targets: number[]) {
    const types = new Set(rows.filter((t) => targets.includes(t.id)).map((t) => t.type));
    if (types.size !== 1) { alert("Sélectionnez uniquement des dépenses, ou uniquement des revenus, pour changer la catégorie."); return; }
    setPicker({ ids: targets, type: [...types][0] });
  }

  return (
    <div className="space-y-4 pb-28">
      <PageHeader title="Vérifier" subtitle={rows.length > 0 ? `${rows.length} transaction${rows.length > 1 ? "s" : ""} importée${rows.length > 1 ? "s" : ""}` : undefined} />
      <ErrorBanner error={bulk.error} />

      {isLoading && <p className="text-slate-500">Chargement…</p>}
      {!isLoading && rows.length === 0 && <Empty icon="✅" text="Tout est vérifié, rien ne vous attend." />}

      {rows.length > 0 && (
        <>
          <p className="text-sm text-slate-500">
            Les lignes sont regroupées par catégorie. Validez un groupe entier d'un tap, ou corrigez d'abord sa catégorie.
            Chaque validation apprend le libellé : au prochain relevé, ces transactions arriveront déjà validées.
          </p>
          <button className="btn-primary w-full" disabled={bulk.isPending} onClick={() => { if (confirm(`Valider les ${rows.length} transactions telles quelles ?`)) void run("confirm", rows.map((t) => t.id)); }}>
            Tout valider ({rows.length})
          </button>
        </>
      )}

      {groups.map((g) => {
        const allChecked = g.items.every((t) => selected.has(t.id));
        return (
          <section key={g.key} className="card space-y-2 p-0">
            <button className="flex w-full items-center gap-3 px-4 pt-3 text-left" onClick={() => toggleGroup(g)}>
              <input type="checkbox" readOnly checked={allChecked} className="size-5 shrink-0 accent-brand" />
              <span className="text-xl">{g.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{g.title}</span>
                <span className="block text-sm text-slate-500">{g.items.length} ligne{g.items.length > 1 ? "s" : ""}</span>
              </span>
              <Money cents={g.total} signed className={`font-semibold ${g.total > 0 ? "text-emerald-600" : ""}`} />
            </button>

            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {g.items.map((t) => (
                <div key={t.id} className="flex items-center gap-3 px-4 py-2">
                  <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} className="size-5 shrink-0 accent-brand" />
                  <Link to={`/transaction/${t.id}`} className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{t.label || t.categoryName}</span>
                    <span className="block text-xs text-slate-500">{t.date.slice(8, 10)}/{t.date.slice(5, 7)} · {t.walletName}</span>
                  </Link>
                  <Money cents={t.type === "income" ? t.amount : -t.amount} signed className={`text-sm ${t.type === "income" ? "text-emerald-600" : ""}`} />
                </div>
              ))}
            </div>

            <div className="flex gap-2 px-4 pb-3">
              <button className="btn-primary flex-1 py-2 text-sm" disabled={bulk.isPending} onClick={() => void run("confirm", g.items.map((t) => t.id))}>
                Valider ces {g.items.length}
              </button>
              <button className="btn-ghost flex-1 py-2 text-sm" disabled={bulk.isPending} onClick={() => ouvrirPicker(g.items.map((t) => t.id))}>
                Changer de catégorie
              </button>
            </div>
          </section>
        );
      })}

      {ids.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
          <div className="mx-auto flex max-w-lg items-center gap-2">
            <span className="shrink-0 text-sm font-semibold">{ids.length} sélectionnée{ids.length > 1 ? "s" : ""}</span>
            <button className="btn-ghost px-3 py-2 text-sm" disabled={bulk.isPending} onClick={() => ouvrirPicker(ids)}>Catégorie</button>
            <button className="btn-danger px-3 py-2 text-sm" disabled={bulk.isPending} onClick={() => { if (confirm(`Supprimer ces ${ids.length} transactions ?`)) void run("delete", ids); }}>Supprimer</button>
            <button className="btn-primary flex-1 py-2 text-sm" disabled={bulk.isPending} onClick={() => void run("confirm", ids)}>Valider</button>
          </div>
        </div>
      )}

      <Sheet open={picker !== null} onClose={() => setPicker(null)} title={`Catégorie pour ${picker?.ids.length ?? 0} transaction${(picker?.ids.length ?? 0) > 1 ? "s" : ""}`}>
        {picker && <CategoryPicker categories={categories} type={picker.type} value={null} onChange={(id) => void reclasser(id)} />}
      </Sheet>
    </div>
  );
}
