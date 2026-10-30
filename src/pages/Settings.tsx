import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Route, Routes } from "react-router-dom";
import {
  useAdjustWallet, useCategories, useDeleteCategory, useDeleteRecurrence, useRecurrences, useRemoveWallet, useRestoreBackup,
  useSaveCategory, useSaveRecurrence, useSaveSettings, useSaveWallet, useAiUsage, useSettings, useTestAiKey, useVersion, useWallets,
} from "@/lib/queries";
import { Money, Sheet, MoneyInput, Field, ErrorBanner, Segmented, PageHeader, Bandeau } from "@/components/ui";
import { IconArchive, IconCard, IconImport, IconRight, IconRobot, IconSwap, IconTag } from "@/components/icons";
import { CategoryPicker } from "@/components/CategoryPicker";
import { ImportSettings } from "./ImportSettings";
import { useDeleteRule, useReglagesFoyer, useRules, useSetAvoidable } from "@/lib/queries";
import { formatCents } from "@shared/money";
import { supabase } from "@/lib/supabase";
import { api } from "@/lib/api";
import { WALLET_TYPES, type Category, type Recurrence, type TxType, type Wallet, type WalletType } from "@shared/types";

const WALLET_LABEL: Record<WalletType, string> = { courant: "Compte courant", especes: "Espèces", livret: "Livret / épargne", autre: "Autre" };
const DAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

export function SettingsPage() {
  return (
    <Routes>
      <Route index element={<SettingsHome />} />
      <Route path="portefeuilles" element={<WalletsSettings />} />
      <Route path="categories" element={<CategoriesSettings />} />
      <Route path="recurrences" element={<RecurrencesSettings />} />
      <Route path="sauvegarde" element={<BackupSettings />} />
      <Route path="import" element={<ImportSettings />} />
      <Route path="regles" element={<RulesSettings />} />
    </Routes>
  );
}

function Back({ title }: { title: string }) {
  return <div className="mb-4"><PageHeader title={title} /></div>;
}

function SettingsHome() {
  const { data: wallets = [] } = useWallets();
  // Les mêmes icônes au trait que partout ailleurs : les emoji ne se colorent
  // pas, ne s'alignent pas entre eux et changent de dessin selon le téléphone.
  const items = [
    { to: "portefeuilles", Icon: IconCard, label: "Portefeuilles", hint: "Soldes, correction du solde" },
    { to: "categories", Icon: IconTag, label: "Catégories", hint: "Ajouter, renommer, supprimer" },
    { to: "recurrences", Icon: IconSwap, label: "Récurrences", hint: "Loyer, salaire, cantine…" },
    { to: "import", Icon: IconImport, label: "Importer un relevé", hint: "Fichier CSV de la banque" },
    { to: "regles", Icon: IconRobot, label: "Règles apprises", hint: "Libellé → catégorie" },
    { to: "sauvegarde", Icon: IconArchive, label: "Sauvegarde et clé IA", hint: "Export, restauration, réglages IA" },
  ];
  const total = wallets.reduce((s, w) => s + w.balance, 0);
  return (
    <div className="space-y-4">
      <Bandeau>
        <p className="text-[17px] font-semibold">Réglages</p>
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[12px] text-white/75">Total de vos portefeuilles</p>
            <p className="text-[30px] font-bold tabular-nums"><Money cents={total} short /></p>
          </div>
          <p className="pb-1 text-[12px] text-white/75">{wallets.length} portefeuille{wallets.length > 1 ? "s" : ""}</p>
        </div>
      </Bandeau>
      <div className="card divide-y divide-slate-100 p-0 dark:divide-slate-800">
        {items.map((i) => (
          <Link key={i.to} to={i.to} className="flex h-[62px] items-center gap-3 px-4">
            <span className="flex size-[38px] shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand"><i.Icon size={19} /></span>
            <div className="min-w-0 flex-1"><p className="text-[15px] font-semibold">{i.label}</p><p className="truncate text-[12px] text-slate-500">{i.hint}</p></div>
            <IconRight size={18} className="shrink-0 text-slate-400" />
          </Link>
        ))}
      </div>
      <PaiementParDefautCarte />
      <AccesCarte />
    </div>
  );
}

/** Espèces, carte ou rien : ce qui est choisi d'office pour une nouvelle dépense, saisie ou dictée. */
function PaiementParDefautCarte() {
  const { data: reglages } = useReglagesFoyer();
  const save = useSaveSettings();
  if (!reglages) return null;
  const valeur = (reglages.paiementParDefaut === "card" || reglages.paiementParDefaut === "aucun" ? reglages.paiementParDefaut : "cash") as "cash" | "card" | "aucun";
  return (
    <div className="card space-y-3">
      <h2 className="font-semibold">Paiement par défaut des dépenses</h2>
      <Segmented
        value={valeur}
        onChange={(v) => save.mutate({ paiementParDefaut: v })}
        options={[{ value: "cash", label: "Espèces" }, { value: "card", label: "Carte" }, { value: "aucun", label: "Aucun" }]}
      />
      <p className="text-xs text-slate-500">
        Choisi d'office pour chaque nouvelle dépense, saisie, dictée ou photo. Dire « par carte » ou « en espèces » en dictant l'emporte toujours.
      </p>
    </div>
  );
}

function WalletsSettings() {
  const { data: wallets = [] } = useWallets(true);
  const save = useSaveWallet();
  const remove = useRemoveWallet();
  const adjust = useAdjustWallet();
  const [form, setForm] = useState<{ id?: number; name: string; type: WalletType; initialBalance: number | null } | null>(null);
  const [adjusting, setAdjusting] = useState<Wallet | null>(null);
  const [real, setReal] = useState<number | null>(null);

  return (
    <div className="space-y-4">
      <Back title="Portefeuilles" />
      {wallets.map((w) => (
        <div key={w.id} className={`card space-y-3 ${w.archived ? "opacity-60" : ""}`}>
          <div className="flex items-center justify-between">
            <div><p className="font-semibold">{w.name}{w.archived && " (archivé)"}</p><p className="text-sm text-slate-500">{WALLET_LABEL[w.type]}</p></div>
            <Money cents={w.balance} className="text-xl font-bold" />
          </div>
          {!w.archived && (
            <div className="grid grid-cols-2 gap-2">
              <button className="btn-ghost text-sm" onClick={() => { setAdjusting(w); setReal(w.balance); }}>Corriger le solde</button>
              <button className="btn-ghost text-sm" onClick={() => setForm({ id: w.id, name: w.name, type: w.type, initialBalance: w.initialBalance })}>Modifier</button>
            </div>
          )}
        </div>
      ))}
      <button className="btn-primary w-full" onClick={() => setForm({ name: "", type: "courant", initialBalance: 0 })}>Ajouter un portefeuille</button>

      <Sheet open={form !== null} onClose={() => setForm(null)} title={form?.id ? "Modifier le portefeuille" : "Nouveau portefeuille"}>
        {form && (
          <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); await save.mutateAsync({ id: form.id, input: { name: form.name, type: form.type, initialBalance: form.initialBalance ?? 0 } }); setForm(null); }}>
            <Field label="Nom"><input className="input" required autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Type">
              <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as WalletType })}>
                {WALLET_TYPES.map((t) => <option key={t} value={t}>{WALLET_LABEL[t]}</option>)}
              </select>
            </Field>
            <Field label="Solde de départ"><MoneyInput value={form.initialBalance} onChange={(v) => setForm({ ...form, initialBalance: v })} /></Field>
            <ErrorBanner error={save.error} />
            <button className="btn-primary w-full" disabled={save.isPending}>Enregistrer</button>
            {form.id && (
              <button type="button" className="btn-danger w-full" onClick={async () => {
                if (!confirm("Supprimer ce portefeuille ? S'il contient des transactions, il sera archivé.")) return;
                await remove.mutateAsync(form.id!); setForm(null);
              }}>Supprimer</button>
            )}
          </form>
        )}
      </Sheet>

      <Sheet open={adjusting !== null} onClose={() => setAdjusting(null)} title={adjusting ? `Solde réel de ${adjusting.name}` : ""}>
        {adjusting && (
          <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); if (real === null) return; await adjust.mutateAsync({ id: adjusting.id, realBalance: real }); setAdjusting(null); }}>
            <p className="text-sm text-slate-500">Saisissez le solde affiché par votre banque. L'écart avec {formatCents(adjusting.balance)} sera enregistré comme correction, sans compter dans vos dépenses.</p>
            <MoneyInput value={real} onChange={setReal} autoFocus />
            {real !== null && real !== adjusting.balance && <p className="text-sm">Correction : <Money cents={real - adjusting.balance} signed className="font-semibold" /></p>}
            <ErrorBanner error={adjust.error} />
            <button className="btn-primary w-full" disabled={adjust.isPending || real === null}>Corriger</button>
          </form>
        )}
      </Sheet>
    </div>
  );
}

function CategoriesSettings() {
  const { data: categories = [] } = useCategories();
  const save = useSaveCategory();
  const remove = useDeleteCategory();
  const setAvoidable = useSetAvoidable();
  const [form, setForm] = useState<{ id?: number; name: string; icon: string; parentId: number | null; kind: Category["kind"]; avoidable: boolean } | null>(null);
  const [reassign, setReassign] = useState<number | null>(null);
  const parents = categories.filter((c) => !c.parentId && !c.technicalKey);

  return (
    <div className="space-y-4">
      <Back title="Catégories" />
      {parents.map((p) => (
        <div key={p.id} className="card space-y-2">
          <div className="flex items-center justify-between">
            <button className="text-left font-semibold" onClick={() => setForm({ id: p.id, name: p.name, icon: p.icon ?? "", parentId: null, kind: p.kind, avoidable: p.avoidable })}>{p.icon} {p.name}{p.avoidable && <span className="ml-1 text-xs text-orange-600">✂️</span>}</button>
            <button className="text-sm text-brand" onClick={() => setForm({ name: "", icon: "", parentId: p.id, kind: p.kind, avoidable: false })}>+ sous-catégorie</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {categories.filter((c) => c.parentId === p.id).map((c) => (
              <button key={c.id} className={`chip ${c.avoidable ? "bg-orange-50 text-orange-800 dark:bg-orange-950 dark:text-orange-200" : "bg-slate-100 dark:bg-slate-800"}`} onClick={() => setForm({ id: c.id, name: c.name, icon: "", parentId: p.id, kind: c.kind, avoidable: c.avoidable })}>{c.avoidable && "✂️ "}{c.name}</button>
            ))}
          </div>
        </div>
      ))}
      <p className="text-xs text-slate-500">✂️ = dépense évitable, comptée dans l'indicateur « Évitables » de l'onglet Suivi.</p>
      <button className="btn-primary w-full" onClick={() => setForm({ name: "", icon: "", parentId: null, kind: "expense", avoidable: false })}>Nouvelle catégorie principale</button>

      <Sheet open={form !== null} onClose={() => setForm(null)} title={form?.id ? "Modifier" : "Nouvelle catégorie"}>
        {form && (
          <form className="space-y-4" onSubmit={async (e) => {
            e.preventDefault();
            const saved = await save.mutateAsync({ id: form.id, input: { name: form.name, icon: form.icon || null, parentId: form.parentId, kind: form.kind } });
            if (saved.avoidable !== form.avoidable) await setAvoidable.mutateAsync({ id: saved.id, avoidable: form.avoidable });
            setForm(null);
          }}>
            <Field label="Nom"><input className="input" required autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            {form.kind === "expense" && (
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.avoidable} onChange={(e) => setForm({ ...form, avoidable: e.target.checked })} /> Dépense évitable (restaurant, sorties, shopping…)</label>
            )}
            {form.parentId === null && (
              <>
                <Field label="Emoji (facultatif)"><input className="input" maxLength={4} value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} placeholder="🏠" /></Field>
                {!form.id && <Segmented value={form.kind} onChange={(k) => setForm({ ...form, kind: k })} options={[{ value: "expense", label: "Dépense" }, { value: "income", label: "Revenu" }]} />}
              </>
            )}
            <ErrorBanner error={save.error || remove.error} />
            <button className="btn-primary w-full" disabled={save.isPending}>Enregistrer</button>
            {form.id && (
              <div className="space-y-2 rounded-xl bg-slate-100 p-3 dark:bg-slate-800">
                <p className="text-sm">Supprimer et déplacer ses transactions vers :</p>
                <select className="input" value={reassign ?? ""} onChange={(e) => setReassign(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">Choisir une catégorie…</option>
                  {categories.filter((c) => c.id !== form.id && c.parentId !== form.id && !c.technicalKey && c.kind === form.kind).map((c) => <option key={c.id} value={c.id}>{c.parentId ? "   " : ""}{c.name}</option>)}
                </select>
                <button type="button" className="btn-danger w-full" onClick={async () => {
                  if (!confirm("Supprimer cette catégorie ?")) return;
                  await remove.mutateAsync({ id: form.id!, reassignTo: reassign }); setForm(null); setReassign(null);
                }}>Supprimer</button>
              </div>
            )}
          </form>
        )}
      </Sheet>
    </div>
  );
}

function RecurrencesSettings() {
  const { data: recurrences = [] } = useRecurrences();
  const { data: wallets = [] } = useWallets();
  const { data: categories = [] } = useCategories();
  const save = useSaveRecurrence();
  const remove = useDeleteRecurrence();
  type Form = { id?: number; label: string; type: TxType; amount: number | null; frequency: "monthly" | "weekly"; day: number; walletId: number | null; toWalletId: number | null; categoryId: number | null; active: boolean };
  const [form, setForm] = useState<Form | null>(null);
  const open = (r?: Recurrence) => setForm(r
    ? { id: r.id, label: r.label, type: r.type, amount: r.amount, frequency: r.frequency, day: r.day, walletId: r.walletId, toWalletId: r.toWalletId, categoryId: r.categoryId, active: r.active }
    : { label: "", type: "expense", amount: null, frequency: "monthly", day: 1, walletId: wallets[0]?.id ?? null, toWalletId: null, categoryId: null, active: true });

  const describe = (r: Recurrence) => r.frequency === "monthly" ? `le ${r.day} de chaque mois` : `chaque ${DAYS[r.day]}`;

  return (
    <div className="space-y-4">
      <Back title="Récurrences" />
      <p className="text-sm text-slate-500">Les transactions sont créées automatiquement à la date prévue et annoncées 7 jours avant sur l'Accueil.</p>
      {recurrences.map((r) => (
        <button key={r.id} className={`card block w-full text-left ${r.active ? "" : "opacity-60"}`} onClick={() => open(r)}>
          <div className="flex items-center justify-between">
            <div><p className="font-semibold">{r.label}{!r.active && " (en pause)"}</p><p className="text-sm text-slate-500">{describe(r)} · {r.categoryName ?? "Virement"} · prochaine : {new Date(r.nextDate).toLocaleDateString("fr-FR")}</p></div>
            <Money cents={r.type === "expense" ? -r.amount : r.amount} signed className={`font-semibold ${r.type === "income" ? "text-emerald-600" : ""}`} />
          </div>
        </button>
      ))}
      <button className="btn-primary w-full" onClick={() => open()}>Ajouter une récurrence</button>

      <Sheet open={form !== null} onClose={() => setForm(null)} title={form?.id ? "Modifier la récurrence" : "Nouvelle récurrence"}>
        {form && (
          <form className="space-y-4" onSubmit={async (e) => {
            e.preventDefault();
            if (!form.amount || !form.walletId) return;
            await save.mutateAsync({ id: form.id, input: { ...form, amount: form.amount, walletId: form.walletId, toWalletId: form.type === "transfer" ? form.toWalletId : null, categoryId: form.type === "transfer" ? null : form.categoryId } });
            setForm(null);
          }}>
            <Segmented value={form.type} onChange={(t) => setForm({ ...form, type: t, categoryId: null })} options={[{ value: "expense", label: "Dépense" }, { value: "income", label: "Revenu" }, { value: "transfer", label: "Virement" }]} />
            <Field label="Libellé"><input className="input" required autoFocus value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Loyer, EDF, salaire…" /></Field>
            <Field label="Montant"><MoneyInput value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Fréquence">
                <select className="input" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value as Form["frequency"], day: 1 })}>
                  <option value="monthly">Chaque mois</option><option value="weekly">Chaque semaine</option>
                </select>
              </Field>
              <Field label={form.frequency === "monthly" ? "Jour du mois" : "Jour"}>
                {form.frequency === "monthly"
                  ? <input type="number" min={1} max={31} className="input" value={form.day} onChange={(e) => setForm({ ...form, day: Number(e.target.value) })} />
                  : <select className="input" value={form.day} onChange={(e) => setForm({ ...form, day: Number(e.target.value) })}>{DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}</select>}
              </Field>
            </div>
            {form.type !== "transfer" && <Field label="Catégorie"><CategoryPicker categories={categories} type={form.type} value={form.categoryId} onChange={(id) => setForm({ ...form, categoryId: id })} /></Field>}
            <div className="grid grid-cols-2 gap-3">
              <Field label={form.type === "transfer" ? "Depuis" : "Portefeuille"}>
                <select className="input" value={form.walletId ?? ""} onChange={(e) => setForm({ ...form, walletId: Number(e.target.value) })}>{wallets.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
              </Field>
              {form.type === "transfer" && (
                <Field label="Vers">
                  <select className="input" value={form.toWalletId ?? ""} onChange={(e) => setForm({ ...form, toWalletId: Number(e.target.value) })}>
                    <option value="">Choisir…</option>{wallets.filter((w) => w.id !== form.walletId).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </Field>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active</label>
            <ErrorBanner error={save.error} />
            <button className="btn-primary w-full" disabled={save.isPending || !form.amount || (form.type !== "transfer" && !form.categoryId)}>Enregistrer</button>
            {form.id && <button type="button" className="btn-danger w-full" onClick={async () => { if (confirm("Supprimer cette récurrence ? Les transactions déjà créées sont conservées.")) { await remove.mutateAsync(form.id!); setForm(null); } }}>Supprimer</button>}
          </form>
        )}
      </Sheet>
    </div>
  );
}

function BackupSettings() {
  const { data: settings = {} } = useSettings();
  const saveSettings = useSaveSettings();
  const testAi = useTestAiKey();
  const { data: version } = useVersion();
  const { data: conso } = useAiUsage();
  const restore = useRestoreBackup();
  const plafondEnregistre = settings.plafondIaUsd ?? "5";
  const [aiKey, setAiKey] = useState("");
  const [plafond, setPlafond] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  /** Les fichiers sont fabriqués dans le navigateur à partir des données du foyer, puis enregistrés. */
  async function telecharger(url: string, format: "json" | "csv") {
    setMessage("Préparation du fichier…");
    try {
      const contenu = await api.get<unknown>(url);
      const blob = format === "json"
        ? new Blob([JSON.stringify(contenu)], { type: "application/json" })
        : new Blob([contenu as string], { type: "text/csv;charset=utf-8" });
      const lien = document.createElement("a");
      lien.href = URL.createObjectURL(blob);
      lien.download = `${format === "json" ? "budget" : "operations"}-${new Date().toISOString().slice(0, 10)}.${format}`;
      lien.click();
      setTimeout(() => URL.revokeObjectURL(lien.href), 10_000);
      setMessage(null);
    } catch (e) {
      setMessage(`Échec : ${(e as Error).message}`);
    }
  }

  async function onRestore(file: File) {
    if (!confirm("Restaurer cette sauvegarde remplace toutes les données du foyer, pour tous ses membres. Continuer ?")) return;
    try {
      setMessage("Restauration en cours…");
      const r = (await restore.mutateAsync(JSON.parse(await file.text()))) as { transactions?: number; ignorees?: number };
      setMessage(`Sauvegarde restaurée : ${r.transactions ?? 0} opérations${r.ignorees ? `, ${r.ignorees} ignorées (portefeuille introuvable)` : ""}. Les photos de la version PC ne sont pas reprises.`);
    } catch (e) {
      setMessage(`Échec : ${(e as Error).message}`);
    }
  }

  return (
    <div className="space-y-4">
      <Back title="Sauvegarde" />
      <div className="card space-y-3">
        <h2 className="font-semibold">Exporter</h2>
        <button className="btn-ghost w-full" onClick={() => telecharger("/api/backup.json", "json")}>Sauvegarde complète (JSON)</button>
        <button className="btn-ghost w-full" onClick={() => telecharger("/api/export.csv", "csv")}>Transactions (CSV pour Excel)</button>
      </div>
      <div className="card space-y-3">
        <h2 className="font-semibold">Restaurer</h2>
        <p className="text-sm text-slate-500">Choisissez un fichier JSON exporté depuis cette application.</p>
        <input type="file" accept="application/json" className="input" onChange={(e) => e.target.files?.[0] && onRestore(e.target.files[0])} />
        {message && <p className="text-sm">{message}</p>}
      </div>
      <div className="card space-y-1 text-xs text-slate-500">
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Version installée</p>
        <p>Code : <span className="font-mono">{version?.commit ?? "…"}</span>{version?.date && ` · ${version.date}`}</p>
        {version?.interfaceLe && <p>Interface construite le {version.interfaceLe}</p>}
      </div>

      <div className="card space-y-2">
        <h2 className="font-semibold">Plafond de dépense IA</h2>
        <p className="text-sm text-slate-500">
          Au-delà de ce montant, les fonctions IA s'arrêtent jusqu'au mois suivant. Le reste de l'application continue de
          fonctionner. Mettez 0 pour ne pas avoir de plafond.
        </p>
        <form
          className="flex items-center gap-2"
          onSubmit={async (e) => { e.preventDefault(); await saveSettings.mutateAsync({ plafondIaUsd: (plafond ?? plafondEnregistre).trim() || "5" }); }}
        >
          <input className="input" inputMode="decimal" value={plafond ?? plafondEnregistre} onChange={(e) => setPlafond(e.target.value)} aria-label="Plafond mensuel en dollars" />
          <span className="text-sm text-slate-500">$ / mois</span>
          <button className="btn-primary">OK</button>
        </form>
        {conso && conso.plafondCents > 0 && (
          <>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className={`h-2 rounded-full ${conso.depasse ? "bg-rose-600" : "bg-brand"}`}
                style={{ width: `${Math.min(100, Math.round((conso.consommeCents / conso.plafondCents) * 100))}%` }}
              />
            </div>
            <p className={`text-xs ${conso.depasse ? "font-semibold text-rose-600" : "text-slate-500"}`}>
              {(conso.consommeCents / 100).toFixed(2)} $ sur {(conso.plafondCents / 100).toFixed(2)} $ ce mois-ci
              {conso.depasse && " — plafond atteint, l'IA est en pause."}
            </p>
          </>
        )}
      </div>

      {conso && conso.appels > 0 && (
        <div className="card space-y-2">
          <div className="flex items-baseline justify-between">
            <h2 className="font-semibold">Ce que l'IA a coûté ce mois-ci</h2>
            <span className="text-lg font-bold tabular-nums">{(conso.centsUsd / 100).toFixed(2)} $</span>
          </div>
          <p className="text-xs text-slate-500">
            {conso.appels} appel{conso.appels > 1 ? "s" : ""} · {conso.entree.toLocaleString("fr-FR")} jetons en entrée,
            {" "}{conso.sortie.toLocaleString("fr-FR")} en sortie. Mesuré, pas estimé.
          </p>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {conso.parFonction.map((f) => (
              <div key={f.fonction} className="flex items-center justify-between py-1.5 text-sm">
                <span className="min-w-0 truncate">{f.fonction}<span className="text-slate-400"> · {f.appels}</span></span>
                <span className="shrink-0 tabular-nums">{(f.centsUsd / 100).toFixed(2)} $</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card space-y-3">
        <h2 className="font-semibold">Clé IA (photo de ticket, dictée, catégorisation)</h2>
        <p className="text-sm text-slate-500">Clé d'API Anthropic, stockée uniquement sur le serveur local. Sans clé, tout le reste fonctionne. {settings.aiKey ? `Clé enregistrée : ${settings.aiKey}` : "Aucune clé enregistrée."}</p>
        <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); try { await saveSettings.mutateAsync({ aiKey: aiKey.trim() }); setAiKey(""); } catch { /* affiché ci-dessous */ } }}>
          <input className="input" type="password" value={aiKey} onChange={(e) => setAiKey(e.target.value)} placeholder="sk-ant-…" autoComplete="off" />
          <button className="btn-primary" disabled={!aiKey.trim()}>OK</button>
        </form>
        <ErrorBanner error={saveSettings.error} />
        {saveSettings.isSuccess && <p className="text-sm text-emerald-600">Clé enregistrée.</p>}
        {settings.aiKey && (
          <>
            <button className="btn-ghost w-full" disabled={testAi.isPending} onClick={() => testAi.mutate()}>
              {testAi.isPending ? "Test en cours…" : "Tester la clé IA"}
            </button>
            <ErrorBanner error={testAi.error} />
            {testAi.data && (
              <div className="space-y-2">
                {testAi.data.essais.map((e) => (
                  <div key={e.id} className={`rounded-xl px-3 py-2 text-sm ${e.ok ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"}`}>
                    <p className="font-semibold">{e.ok ? "Fonctionne" : "En panne"} · {e.id}</p>
                    <p className="text-xs opacity-90">{e.role}</p>
                    {e.probleme && <p className="mt-1 font-medium">{e.probleme}</p>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function RulesSettings() {
  const { data: rules = [] } = useRules();
  const remove = useDeleteRule();
  return (
    <div className="space-y-4">
      <Back title="Règles apprises" />
      <p className="text-sm text-slate-500">Chaque fois que vous choisissez une catégorie pour un libellé, l'application s'en souvient. Les libellés importés qui ressemblent à ces motifs sont catégorisés sans IA.</p>
      {rules.length === 0 && <p className="card text-sm text-slate-500">Aucune règle pour l'instant. Elles se créent toutes seules à la saisie.</p>}
      {rules.length > 0 && (
        <div className="card divide-y divide-slate-100 p-0 dark:divide-slate-800">
          {rules.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{r.pattern}</p>
                <p className="text-slate-500">→ {r.categoryName} · utilisée {r.hits} fois</p>
              </div>
              <button className="text-slate-400" aria-label="Supprimer la règle" onClick={() => remove.mutate(r.id)}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface Foyer { id: string; nom: string; code_invitation: string }

/**
 * Le foyer partagé : qui en fait partie, et le code qui permet au conjoint de le
 * rejoindre. Chacun garde son propre compte ; les données sont communes.
 */
function AccesCarte() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["foyer"],
    queryFn: async () => {
      const [{ data: foyer, error }, { data: membres, error: e2 }, { data: moi }] = await Promise.all([
        supabase.from("foyers").select("id, nom, code_invitation").single(),
        supabase.from("membres").select("user_id, prenom, role").order("created_at"),
        supabase.auth.getUser(),
      ]);
      if (error || e2) throw new Error((error ?? e2)!.message);
      return { foyer: foyer as Foyer, membres: membres as { user_id: string; prenom: string; role: string }[], moi: moi.user };
    },
  });
  const [message, setMessage] = useState<string | null>(null);
  if (!data) return null;

  async function renouveler() {
    if (!confirm("L'ancien code ne permettra plus de rejoindre le foyer. Continuer ?")) return;
    const { error } = await supabase.rpc("renouveler_code");
    setMessage(error ? error.message : "Nouveau code créé.");
    void qc.invalidateQueries({ queryKey: ["foyer"] });
  }

  async function copier() {
    try {
      await navigator.clipboard.writeText(data!.foyer.code_invitation);
      setMessage("Code copié.");
    } catch {
      setMessage("Copie impossible : recopiez le code à la main.");
    }
  }

  return (
    <div className="card space-y-3">
      <h2 className="font-semibold">Foyer : {data.foyer.nom}</h2>
      <ul className="space-y-1 text-sm">
        {data.membres.map((m) => (
          <li key={m.user_id} className="flex justify-between">
            <span>{m.prenom || "Sans prénom"}{m.user_id === data.moi?.id && " (vous)"}</span>
            <span className="text-slate-500">{m.role === "proprietaire" ? "Créateur" : "Membre"}</span>
          </li>
        ))}
      </ul>
      <div className="space-y-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Pour inviter votre conjoint : il crée son compte dans l'application, puis saisit ce code.
        </p>
        <p className="text-center font-mono text-2xl font-bold tracking-[0.3em]">{data.foyer.code_invitation}</p>
        <div className="grid grid-cols-2 gap-2">
          <button className="btn-ghost" onClick={copier}>Copier</button>
          <button className="btn-ghost" onClick={renouveler}>Nouveau code</button>
        </div>
      </div>
      {message && <p className="text-sm text-emerald-700 dark:text-emerald-400">{message}</p>}
      <p className="text-xs text-slate-500">Connecté avec {data.moi?.email}.</p>
      <button className="btn-ghost w-full" onClick={async () => { await supabase.auth.signOut(); window.location.replace("/"); }}>
        Se déconnecter de cet appareil
      </button>
    </div>
  );
}
