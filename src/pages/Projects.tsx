import { useState } from "react";
import { useContribute, useDeleteProject, useProjects, useSaveProject, useWallets } from "@/lib/queries";
import { Money, ProgressBar, Sheet, MoneyInput, Field, ErrorBanner, Empty, PageHeader } from "@/components/ui";
import { formatCents } from "@shared/money";
import type { Project } from "@shared/types";

export function ProjectsPage() {
  const { data: projects = [] } = useProjects();
  const { data: wallets = [] } = useWallets();
  const save = useSaveProject();
  const remove = useDeleteProject();
  const contribute = useContribute();

  const [form, setForm] = useState<{ id?: number; name: string; target: number | null; dueDate: string; walletId: number | null } | null>(null);
  const [feeding, setFeeding] = useState<Project | null>(null);
  const [feedAmount, setFeedAmount] = useState<number | null>(null);
  const [fromWallet, setFromWallet] = useState<number | null>(null);

  const openNew = () => setForm({ name: "", target: null, dueDate: "", walletId: wallets.find((w) => w.type === "livret")?.id ?? wallets[0]?.id ?? null });
  const openEdit = (p: Project) => setForm({ id: p.id, name: p.name, target: p.target, dueDate: p.dueDate ?? "", walletId: p.walletId });

  return (
    <div className="space-y-4">
      <PageHeader title="Projets" right={<button className="btn-primary shrink-0 px-3 py-2 text-sm" onClick={openNew}>Nouveau</button>} />
      {projects.length === 0 && <Empty icon="🎯" text="Vacances, voiture, fonds d'urgence… Créez votre premier projet d'épargne." />}
      {projects.map((p) => (
        <div key={p.id} className={`card space-y-2 ${p.done ? "opacity-70" : ""}`}>
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-semibold">{p.done ? "✅ " : ""}{p.name}</h2>
              <p className="text-sm text-slate-500">
                Sur {p.walletName}{p.dueDate && ` · pour le ${new Date(p.dueDate).toLocaleDateString("fr-FR")}`}
              </p>
            </div>
            <button className="text-sm text-slate-500" onClick={() => openEdit(p)}>Modifier</button>
          </div>
          <p className="text-3xl font-bold"><Money cents={p.saved} /> <span className="text-base font-normal text-slate-500">sur <Money cents={p.target} /></span></p>
          <ProgressBar ratio={p.ratio} status={p.done ? "green" : "green"} />
          {!p.done && (
            <p className="text-sm text-slate-500">
              Reste <Money cents={p.remaining} className="font-semibold" />
              {p.monthlyNeeded !== null && <> · il faut mettre <Money cents={p.monthlyNeeded} className="font-semibold" /> par mois pour tenir la date</>}
            </p>
          )}
          {!p.done && (
            <button className="btn-ghost w-full" onClick={() => { setFeeding(p); setFeedAmount(null); setFromWallet(wallets.find((w) => w.id !== p.walletId)?.id ?? null); }}>
              Mettre de côté
            </button>
          )}
        </div>
      ))}

      <Sheet open={form !== null} onClose={() => setForm(null)} title={form?.id ? "Modifier le projet" : "Nouveau projet"}>
        {form && (
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!form.target || !form.walletId) return;
              await save.mutateAsync({ id: form.id, input: { name: form.name, target: form.target, dueDate: form.dueDate || null, walletId: form.walletId } });
              setForm(null);
            }}
          >
            <Field label="Nom du projet"><input className="input" required autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Vacances d'été" /></Field>
            <Field label="Montant à atteindre"><MoneyInput value={form.target} onChange={(v) => setForm({ ...form, target: v })} /></Field>
            <Field label="Date souhaitée (facultatif)"><input type="date" className="input" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></Field>
            <Field label="Portefeuille où l'argent est mis de côté">
              <select className="input" value={form.walletId ?? ""} onChange={(e) => setForm({ ...form, walletId: Number(e.target.value) })}>
                {wallets.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </Field>
            <ErrorBanner error={save.error} />
            <button className="btn-primary w-full" disabled={save.isPending || !form.target}>Enregistrer</button>
            {form.id && (
              <button type="button" className="btn-danger w-full" onClick={async () => { if (confirm("Supprimer ce projet ? Les virements déjà faits restent dans vos opérations.")) { await remove.mutateAsync(form.id!); setForm(null); } }}>
                Supprimer le projet
              </button>
            )}
          </form>
        )}
      </Sheet>

      <Sheet open={feeding !== null} onClose={() => setFeeding(null)} title={feeding ? `Mettre de côté pour ${feeding.name}` : ""}>
        {feeding && (
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!feedAmount || !fromWallet) return;
              await contribute.mutateAsync({ id: feeding.id, amount: feedAmount, fromWalletId: fromWallet });
              setFeeding(null);
            }}
          >
            <MoneyInput value={feedAmount} onChange={setFeedAmount} autoFocus />
            <Field label="Depuis">
              <select className="input" value={fromWallet ?? ""} onChange={(e) => setFromWallet(Number(e.target.value))}>
                {wallets.filter((w) => w.id !== feeding.walletId).map((w) => <option key={w.id} value={w.id}>{w.name} ({formatCents(w.balance)})</option>)}
              </select>
            </Field>
            <p className="text-sm text-slate-500">Un virement interne vers {feeding.walletName} sera enregistré. Il ne compte pas comme une dépense.</p>
            <ErrorBanner error={contribute.error} />
            <button className="btn-primary w-full" disabled={contribute.isPending || !feedAmount}>Valider</button>
          </form>
        )}
      </Sheet>
    </div>
  );
}
