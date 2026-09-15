import { useState } from "react";
import { Link, Route, Routes } from "react-router-dom";
import {
  useAdjustWallet, useCategories, useDeleteCategory, useDeleteRecurrence, useRecurrences, useRemoveWallet, useRestoreBackup,
  useSaveCategory, useSaveRecurrence, useSaveSettings, useSaveWallet, useSettings, useTestAiKey, useWallets,
} from "@/lib/queries";
import { Money, Sheet, MoneyInput, Field, ErrorBanner, Segmented, PageHeader } from "@/components/ui";
import { CategoryPicker } from "@/components/CategoryPicker";
import { ImportSettings } from "./ImportSettings";
import { useDeleteRule, useRules, useSetAvoidable } from "@/lib/queries";
import { formatCents } from "@shared/money";
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
  const items = [
    { to: "portefeuilles", icon: "👛", label: "Portefeuilles", hint: "Soldes, correction du solde" },
    { to: "categories", icon: "🏷️", label: "Catégories", hint: "Ajouter, renommer, supprimer" },
    { to: "recurrences", icon: "🔁", label: "Récurrences", hint: "Loyer, salaire, cantine…" },
    { to: "import", icon: "📥", label: "Importer un relevé", hint: "Fichier CSV de la banque" },
    { to: "regles", icon: "🧠", label: "Règles apprises", hint: "Libellé → catégorie" },
    { to: "sauvegarde", icon: "💾", label: "Sauvegarde et clé IA", hint: "Export, restauration, réglages IA" },
  ];
  return (
    <div className="space-y-4">
      <PageHeader title="Réglages" />
      <div className="card divide-y divide-slate-100 p-0 dark:divide-slate-800">
        {items.map((i) => (
          <Link key={i.to} to={i.to} className="flex items-center gap-3 px-4 py-4">
            <span className="text-2xl">{i.icon}</span>
            <div className="flex-1"><p className="font-medium">{i.label}</p><p className="text-sm text-slate-500">{i.hint}</p></div>
            <span className="text-slate-400">›</span>
          </Link>
        ))}
      </div>
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
  const restore = useRestoreBackup();
  const [aiKey, setAiKey] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function onRestore(file: File) {
    if (!confirm("Restaurer cette sauvegarde remplace toutes les données actuelles. Continuer ?")) return;
    try {
      await restore.mutateAsync(JSON.parse(await file.text()));
      setMessage("Sauvegarde restaurée.");
    } catch (e) {
      setMessage(`Échec : ${(e as Error).message}`);
    }
  }

  return (
    <div className="space-y-4">
      <Back title="Sauvegarde" />
      <div className="card space-y-3">
        <h2 className="font-semibold">Exporter</h2>
        <a className="btn-ghost w-full" href="/api/backup.json" download>Sauvegarde complète (JSON)</a>
        <a className="btn-ghost w-full" href="/api/export.csv" download>Transactions (CSV pour Excel)</a>
      </div>
      <div className="card space-y-3">
        <h2 className="font-semibold">Restaurer</h2>
        <p className="text-sm text-slate-500">Choisissez un fichier JSON exporté depuis cette application.</p>
        <input type="file" accept="application/json" className="input" onChange={(e) => e.target.files?.[0] && onRestore(e.target.files[0])} />
        {message && <p className="text-sm">{message}</p>}
      </div>
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
