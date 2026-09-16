import { useState } from "react";
import { useContribute, useDeleteProject, useProjects, useSaveProject, useWallets } from "@/lib/queries";
import { Money, ProgressBar, Sheet, MoneyInput, Field, ErrorBanner, Empty, Bandeau, BandeauStat } from "@/components/ui";
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

  // Ce qu'un père veut voir en arrivant : combien est déjà de côté, et combien
  // il faut mettre chaque mois pour tenir les dates promises.
  const enCours = projects.filter((p) => !p.done);
  const epargne = projects.reduce((s, p) => s + p.saved, 0);
  const objectif = projects.reduce((s, p) => s + p.target, 0);
  const parMois = enCours.reduce((s, p) => s + (p.monthlyNeeded ?? 0), 0);

  return (
    <div className="space-y-4">
      <Bandeau>
        <div className="flex items-center justify-between">
          <span className="text-[17px] font-semibold">Projets</span>
          <button className="-mr-2 flex h-11 items-center rounded-full bg-white/15 px-4 text-sm font-semibold" onClick={openNew}>Nouveau</button>
        </div>
        {projects.length > 0 && (
          <>
            <div>
              <p className="text-[12px] text-white/75">Déjà mis de côté</p>
              <p className="text-[30px] font-bold tabular-nums"><Money cents={epargne} short /></p>
            </div>
            <div className="h-[7px] rounded-full bg-white/25">
              <div className="h-[7px] rounded-full bg-white" style={{ width: `${Math.min(100, Math.round((objectif > 0 ? epargne / objectif : 0) * 100))}%` }} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <BandeauStat label="Objectif" value={<Money cents={objectif} short />} />
              <BandeauStat label="En cours" value={`${enCours.length} projet${enCours.length > 1 ? "s" : ""}`} />
              <BandeauStat label="À mettre / mois" value={parMois > 0 ? <Money cents={parMois} short /> : "—"} />
            </div>
          </>
        )}
      </Bandeau>
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
            <button className="-my-2 flex h-11 items-center px-2 text-sm font-medium text-slate-500" onClick={() => openEdit(p)}>Modifier</button>
          </div>
          {/* En dinars entiers : « 85 000,00 DA sur 300 000,00 DA » passait à la ligne sur un téléphone. */}
          <p className="text-[26px] font-bold tabular-nums"><Money cents={p.saved} short /> <span className="text-[15px] font-normal text-slate-500">sur <Money cents={p.target} short /></span></p>
          <ProgressBar ratio={p.ratio} status={p.done ? "green" : "green"} />
          {!p.done && (
            <p className="text-sm text-slate-500">
              Reste <Money cents={p.remaining} short className="font-semibold" />
              {p.monthlyNeeded !== null && <> · <Money cents={p.monthlyNeeded} short className="font-semibold" /> par mois pour tenir la date</>}
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
              <button type="button" className="btn-danger w-full" onClick={async () => { if (confirm("Supprimer ce projet ? Les virements déjà faits restent dans vos transactions.")) { await remove.mutateAsync(form.id!); setForm(null); } }}>
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
