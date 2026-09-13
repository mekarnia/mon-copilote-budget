import { useState } from "react";
import { Link } from "react-router-dom";
import { useCancelImport, useImportCommit, useImportPreview, useImports, useWallets, type ImportPreviewResult } from "@/lib/queries";
import { Money, Field, ErrorBanner, PageHeader } from "@/components/ui";
import type { ImportColumnMapping } from "@shared/types";

function Back({ title }: { title: string }) {
  return <div className="mb-4"><PageHeader title={title} /></div>;
}

export function ImportSettings() {
  const { data: wallets = [] } = useWallets();
  const { data: imports = [] } = useImports();
  const previewMut = useImportPreview();
  const commitMut = useImportCommit();
  const cancelMut = useCancelImport();

  const [file, setFile] = useState<File | null>(null);
  const [bank, setBank] = useState("");
  const [walletId, setWalletId] = useState<number | null>(null);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [mapping, setMapping] = useState<ImportColumnMapping | null>(null);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [done, setDone] = useState<{ created: number; skipped: number } | null>(null);

  const effectiveWallet = walletId ?? wallets[0]?.id ?? null;

  async function runPreview(override?: ImportColumnMapping) {
    if (!file || effectiveWallet === null) return;
    const p = await previewMut.mutateAsync({ file, walletId: effectiveWallet, bank, mapping: override });
    setPreview(p);
    setMapping(p.mapping);
    setDone(null);
  }

  function updateMapping(patch: Partial<ImportColumnMapping>) {
    if (!mapping) return;
    const next = { ...mapping, ...patch };
    setMapping(next);
    void runPreview(next);
  }

  async function runCommit() {
    if (!preview || !mapping || effectiveWallet === null) return;
    const batch = await commitMut.mutateAsync({ bank: bank || "Ma banque", walletId: effectiveWallet, mapping, csv: preview.csv, fileName: file?.name ?? "", skipDuplicates });
    setDone({ created: batch.createdCount, skipped: batch.skippedCount });
    setPreview(null);
    setFile(null);
  }

  const valid = preview?.rows.filter((r) => !r.error) ?? [];
  const dupes = valid.filter((r) => r.duplicate).length;
  const errors = (preview?.rows.length ?? 0) - valid.length;
  const toCreate = valid.length - (skipDuplicates ? dupes : 0);
  const colOptions = (allowNone: boolean) => (
    <>
      {allowNone && <option value="">—</option>}
      {preview?.columns.map((c, i) => <option key={i} value={i}>{c}</option>)}
    </>
  );
  const num = (v: string) => (v === "" ? null : Number(v));

  return (
    <div className="space-y-4">
      <Back title="Importer un relevé" />
      <p className="text-sm text-slate-500">Téléchargez le relevé au format CSV depuis le site de votre banque, puis choisissez-le ici. Les transactions arrivent « à vérifier » et vous les confirmez en un tap.</p>

      {done && (
        <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
          ✅ {done.created} transaction{done.created > 1 ? "s" : ""} importée{done.created > 1 ? "s" : ""}{done.skipped > 0 && `, ${done.skipped} ignorée${done.skipped > 1 ? "s" : ""} (doublons ou lignes illisibles)`}.
          <Link to="/operations" className="ml-1 font-semibold underline">Vérifier</Link>
        </div>
      )}

      <div className="card space-y-3">
        <Field label="Banque (pour mémoriser le format)">
          <input className="input" list="banks" value={bank} onChange={(e) => setBank(e.target.value)} placeholder="Ma banque" />
          <datalist id="banks">{preview?.banks.map((b) => <option key={b} value={b} />)}</datalist>
        </Field>
        <Field label="Portefeuille concerné">
          <select className="input" value={effectiveWallet ?? ""} onChange={(e) => setWalletId(Number(e.target.value))}>
            {wallets.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </Field>
        <Field label="Fichier CSV">
          <input type="file" accept=".csv,text/csv,text/plain" className="input" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }} />
        </Field>
        <ErrorBanner error={previewMut.error} />
        <button className="btn-primary w-full" disabled={!file || previewMut.isPending} onClick={() => runPreview()}>
          {previewMut.isPending ? "Lecture…" : "Lire le fichier"}
        </button>
      </div>

      {preview && mapping && (
        <>
          <div className="card space-y-3">
            <h2 className="font-semibold">Colonnes {preview.savedMapping && <span className="text-sm font-normal text-slate-500">(format mémorisé)</span>}</h2>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date"><select className="input" value={mapping.date} onChange={(e) => updateMapping({ date: Number(e.target.value) })}>{colOptions(false)}</select></Field>
              <Field label="Format de date">
                <select className="input" value={mapping.dateFormat} onChange={(e) => updateMapping({ dateFormat: e.target.value as ImportColumnMapping["dateFormat"] })}>
                  <option value="dmy">jour/mois/année</option><option value="ymd">année-mois-jour</option><option value="mdy">mois/jour/année</option>
                </select>
              </Field>
              <Field label="Libellé"><select className="input" value={mapping.label} onChange={(e) => updateMapping({ label: Number(e.target.value) })}>{colOptions(false)}</select></Field>
              <Field label="Montant (signé)"><select className="input" value={mapping.amount ?? ""} onChange={(e) => updateMapping({ amount: num(e.target.value) })}>{colOptions(true)}</select></Field>
              <Field label="Débit"><select className="input" value={mapping.debit ?? ""} onChange={(e) => updateMapping({ debit: num(e.target.value), amount: e.target.value ? null : mapping.amount })}>{colOptions(true)}</select></Field>
              <Field label="Crédit"><select className="input" value={mapping.credit ?? ""} onChange={(e) => updateMapping({ credit: num(e.target.value), amount: e.target.value ? null : mapping.amount })}>{colOptions(true)}</select></Field>
            </div>
            <p className="text-xs text-slate-500">Choisissez soit une colonne Montant signé, soit Débit et Crédit.</p>
          </div>

          <div className="card space-y-2">
            <h2 className="font-semibold">Aperçu · {valid.length} ligne{valid.length > 1 ? "s" : ""} lisible{valid.length > 1 ? "s" : ""}{errors > 0 && `, ${errors} illisible${errors > 1 ? "s" : ""}`}{dupes > 0 && `, ${dupes} déjà présente${dupes > 1 ? "s" : ""}`}</h2>
            <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto text-sm dark:divide-slate-800">
              {preview.rows.slice(0, 200).map((r, i) => (
                <div key={i} className={`flex items-center gap-2 py-1.5 ${r.error ? "text-red-600" : r.duplicate ? "opacity-50" : ""}`}>
                  <span className="w-14 shrink-0 whitespace-nowrap text-slate-500">{r.date ? r.date.slice(8, 10) + "/" + r.date.slice(5, 7) : "?"}</span>
                  <span className="min-w-0 flex-1 truncate">{r.label || "(sans libellé)"}{r.duplicate && " · doublon"}{r.error && ` · ${r.error}`}</span>
                  {r.amount !== null && <Money cents={r.amount} signed className={r.amount > 0 ? "text-emerald-600" : ""} />}
                </div>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={skipDuplicates} onChange={(e) => setSkipDuplicates(e.target.checked)} /> Ignorer les doublons</label>
            <ErrorBanner error={commitMut.error} />
            <button className="btn-primary w-full" disabled={toCreate === 0 || commitMut.isPending} onClick={runCommit}>
              {commitMut.isPending ? "Import en cours…" : `Importer ${toCreate} transaction${toCreate > 1 ? "s" : ""}`}
            </button>
          </div>
        </>
      )}

      {imports.length > 0 && (
        <div className="card space-y-2">
          <h2 className="font-semibold">Imports précédents</h2>
          {imports.map((b) => (
            <div key={b.id} className="flex items-center justify-between text-sm">
              <div>
                <p className="font-medium">{b.bank} · {b.walletName}</p>
                <p className="text-slate-500">{new Date(b.createdAt + "Z").toLocaleDateString("fr-FR")} · {b.createdCount} importée{b.createdCount > 1 ? "s" : ""}, {b.remaining} encore présente{b.remaining > 1 ? "s" : ""}</p>
              </div>
              {b.remaining > 0 && (
                <button className="btn-danger px-3 py-1.5 text-xs" onClick={() => { if (confirm(`Annuler cet import et supprimer ses ${b.remaining} transactions ?`)) cancelMut.mutate(b.id); }}>Annuler</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
