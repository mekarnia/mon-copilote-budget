import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  categorize, useCategories, useConfirmTransaction, useDeleteTransaction, useExtractReceipt, useLabels, useParseSpeech,
  useRemovePhoto, useSaveTransaction, useTransaction, useUploadPhoto, useWallets,
} from "@/lib/queries";
import { createRecognizer, transcriptOf } from "@/lib/speech";
import { MoneyInput, Segmented, Field, ErrorBanner } from "@/components/ui";
import { CategoryPicker } from "@/components/CategoryPicker";
import { todayIso } from "@shared/dates";
import { formatCents } from "@shared/money";
import type { TransactionDraft, TxType } from "@shared/types";

const TYPE_OPTIONS: { value: TxType; label: string }[] = [
  { value: "expense", label: "Dépense" },
  { value: "income", label: "Revenu" },
  { value: "transfer", label: "Virement" },
];

export function TransactionFormPage() {
  const navigate = useNavigate();
  const params = useParams();
  const editId = params.id ? Number(params.id) : null;
  const { data: existing } = useTransaction(editId);
  const { data: wallets = [] } = useWallets();
  const { data: categories = [] } = useCategories();
  const save = useSaveTransaction();
  const remove = useDeleteTransaction();
  const confirmTx = useConfirmTransaction();
  const upload = useUploadPhoto();
  const removePhoto = useRemovePhoto();
  const extract = useExtractReceipt();
  const parseSpeech = useParseSpeech();
  const fileRef = useRef<HTMLInputElement>(null);
  const receiptRef = useRef<HTMLInputElement>(null);

  const [type, setType] = useState<TxType>("expense");
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(todayIso());
  const [walletId, setWalletId] = useState<number | null>(null);
  const [toWalletId, setToWalletId] = useState<number | null>(null);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
  const [labelFocused, setLabelFocused] = useState(false);
  const { data: suggestions = [] } = useLabels(labelFocused ? label : "");

  // MVC 2 : brouillon IA, dictée, catégorie proposée
  const [draftInfo, setDraftInfo] = useState<{ source: "photo" | "voice"; question: string | null } | null>(null);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [suggested, setSuggested] = useState<"rule" | "ai" | null>(null);
  const [describe, setDescribe] = useState("");
  const [showDescribe, setShowDescribe] = useState(false);
  const insecure = typeof window !== "undefined" && !window.isSecureContext;
  const recognizerRef = useRef<ReturnType<typeof createRecognizer>>(null);
  const speechAvailable = typeof window !== "undefined" && createRecognizer() !== null;

  useEffect(() => {
    if (walletId === null && wallets.length) setWalletId(wallets[0].id);
  }, [wallets, walletId]);

  useEffect(() => {
    if (!existing) return;
    setType(existing.type);
    setAmount(existing.amount);
    setDate(existing.date);
    setWalletId(existing.walletId);
    setToWalletId(existing.toWalletId);
    setCategoryId(existing.technical ? null : existing.categoryId);
    setLabel(existing.label);
    setNote(existing.note);
    if (existing.note) setShowMore(true);
  }, [existing]);

  useEffect(() => () => recognizerRef.current?.abort(), []);

  function applyDraft(d: TransactionDraft) {
    if (d.type) setType(d.type);
    if (d.amount) setAmount(d.amount);
    if (d.date) setDate(d.date);
    if (d.walletId && wallets.some((w) => w.id === d.walletId)) setWalletId(d.walletId);
    if (d.toWalletId) setToWalletId(d.toWalletId);
    if (d.categoryId && categories.some((c) => c.id === d.categoryId)) setCategoryId(d.categoryId);
    setLabel(d.label);
    setDraftInfo({ source: d.source, question: d.question });
  }

  async function onReceipt(file: File) {
    setPendingPhoto(file);
    setShowMore(true);
    try {
      applyDraft(await extract.mutateAsync(file));
    } catch {
      /* l'erreur est affichée par ErrorBanner, la photo reste attachée */
    }
  }

  function toggleListening() {
    if (listening) {
      recognizerRef.current?.stop();
      return;
    }
    const r = createRecognizer();
    if (!r) return;
    recognizerRef.current = r;
    setTranscript("");
    setListening(true);
    r.onresult = (e) => setTranscript(transcriptOf(e));
    r.onerror = () => setListening(false);
    r.onend = () => {
      setListening(false);
      setTranscript((t) => {
        if (t) parseSpeech.mutateAsync(t).then(applyDraft).catch(() => undefined);
        return t;
      });
    };
    r.start();
  }

  async function onLabelBlur() {
    setTimeout(() => setLabelFocused(false), 150);
    if (categoryId !== null || type === "transfer" || label.trim().length < 2) return;
    try {
      const s = await categorize(label);
      if (s.categoryId && categories.some((c) => c.id === s.categoryId)) {
        setCategoryId(s.categoryId);
        setSuggested(s.source === "rule" ? "rule" : "ai");
        if (s.walletId) setWalletId(s.walletId);
      }
    } catch {
      /* pas de suggestion */
    }
  }

  const canSave = amount !== null && amount > 0 && walletId !== null && (type === "transfer" ? toWalletId !== null && toWalletId !== walletId : categoryId !== null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave || amount === null || walletId === null) return;
    const saved = await save.mutateAsync({
      id: editId ?? undefined,
      input: { type, amount, date, walletId, toWalletId: type === "transfer" ? toWalletId : null, categoryId: type === "transfer" ? null : categoryId, projectId: existing?.projectId ?? null, label, note },
    });
    if (pendingPhoto) await upload.mutateAsync({ id: saved.id, file: pendingPhoto });
    navigate(-1);
  }

  const isAdjustment = existing?.technical && existing.type !== "transfer";
  const toVerify = existing?.status === "to_verify";
  const busy = extract.isPending || parseSpeech.isPending;

  return (
    <div className="mx-auto min-h-full max-w-lg px-4 pb-10 pt-4">
      <div className="mb-4 flex items-center justify-between">
        <button className="btn-ghost px-3 py-2" onClick={() => navigate(-1)}>Annuler</button>
        <h1 className="text-lg font-bold">{editId ? (toVerify ? "À vérifier" : "Modifier") : "Ajouter"}</h1>
        <span className="w-20" />
      </div>

      {!editId && (
        <div className="mb-3 grid grid-cols-3 gap-2">
          <button type="button" className={`btn px-2 ${listening ? "bg-red-600 text-white" : "btn-ghost"}`} onClick={toggleListening} disabled={!speechAvailable || insecure || busy}>
            {listening ? "⏹ Stop" : "🎤 Dicter"}
          </button>
          <button type="button" className={`btn-ghost px-2 ${showDescribe ? "ring-2 ring-brand" : ""}`} onClick={() => setShowDescribe((v) => !v)} disabled={busy}>✍️ Décrire</button>
          <button type="button" className="btn-ghost px-2" onClick={() => receiptRef.current?.click()} disabled={busy}>📷 Ticket</button>
          <input ref={receiptRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && onReceipt(e.target.files[0])} />
        </div>
      )}
      {!editId && showDescribe && (
        <form
          className="mb-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (describe.trim()) parseSpeech.mutateAsync(describe.trim()).then(applyDraft).catch(() => undefined);
          }}
        >
          <input className="input" autoFocus value={describe} onChange={(e) => setDescribe(e.target.value)} placeholder="45 euros de courses chez Carrefour hier" disabled={busy} />
          <button className="btn-primary" disabled={!describe.trim() || busy}>OK</button>
        </form>
      )}
      {!editId && showDescribe && <p className="mb-3 text-xs text-slate-500">Astuce : le micro du clavier du téléphone fonctionne dans ce champ.</p>}
      {!editId && insecure && !showDescribe && (
        <p className="mb-3 text-xs text-slate-500">Micro et appareil photo indisponibles sur une adresse en http:// : utilisez « Décrire » avec le micro du clavier, ou autorisez cette adresse dans chrome://flags (« Insecure origins treated as secure »).</p>
      )}
      {!editId && !speechAvailable && !insecure && <p className="mb-3 text-xs text-slate-500">La dictée n'est disponible que dans Chrome (Android ou ordinateur).</p>}
      {(listening || transcript) && !busy && <p className="mb-3 rounded-xl bg-slate-100 px-3 py-2 text-sm dark:bg-slate-800">{transcript || "Parlez, par exemple : « 45 euros de courses chez Carrefour hier »"}</p>}
      {busy && <p className="mb-3 rounded-xl bg-brand/10 px-3 py-2 text-sm">🤖 Lecture en cours…</p>}
      {draftInfo && !busy && (
        <div className="mb-3 rounded-xl bg-brand/10 px-3 py-2 text-sm">
          <p>{draftInfo.source === "photo" ? "Ticket lu." : "Compris."} Vérifiez puis appuyez sur Ajouter.</p>
          {draftInfo.question && <p className="mt-1 font-semibold">❓ {draftInfo.question}</p>}
        </div>
      )}
      <ErrorBanner error={extract.error || parseSpeech.error} />

      {toVerify && (
        <div className="mb-3 flex items-center justify-between rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <span>Importée du relevé, à vérifier.</span>
          <button type="button" className="rounded-lg bg-amber-600 px-3 py-1 font-semibold text-white" onClick={async () => { await confirmTx.mutateAsync(existing!.id); navigate(-1); }}>C'est bon</button>
        </div>
      )}
      {isAdjustment && <p className="mb-3 rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-600 dark:bg-slate-800">Correction de solde automatique. Vous pouvez la supprimer si elle est erronée.</p>}

      <form onSubmit={submit} className="mt-2 space-y-5">
        {!isAdjustment && <Segmented value={type} onChange={(t) => { setType(t); setCategoryId(null); setSuggested(null); }} options={TYPE_OPTIONS} />}
        <MoneyInput value={amount} onChange={setAmount} autoFocus={!editId} />

        {type !== "transfer" && !isAdjustment && (
          <Field label={suggested ? `Catégorie (${suggested === "rule" ? "d'après vos habitudes" : "proposée par l'IA"})` : "Catégorie"}>
            <CategoryPicker categories={categories} type={type} value={categoryId} onChange={(id) => { setCategoryId(id); setSuggested(null); }} />
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label={type === "transfer" ? "Depuis" : "Portefeuille"}>
            <select className="input" value={walletId ?? ""} onChange={(e) => setWalletId(Number(e.target.value))}>
              {wallets.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </Field>
          {type === "transfer" ? (
            <Field label="Vers">
              <select className="input" value={toWalletId ?? ""} onChange={(e) => setToWalletId(Number(e.target.value))}>
                <option value="">Choisir…</option>
                {wallets.filter((w) => w.id !== walletId).map((w) => <option key={w.id} value={w.id}>{w.name} ({formatCents(w.balance)})</option>)}
              </select>
            </Field>
          ) : (
            <Field label="Date"><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
          )}
        </div>
        {type === "transfer" && <Field label="Date"><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>}

        {!isAdjustment && (
          <Field label="Libellé (facultatif)">
            <div className="relative">
              <input className="input" value={label} placeholder={type === "expense" ? "Carrefour, cantine, essence…" : "Salaire, CAF…"} onChange={(e) => setLabel(e.target.value)}
                onFocus={() => setLabelFocused(true)} onBlur={onLabelBlur} />
              {labelFocused && suggestions.length > 0 && (
                <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow dark:border-slate-700 dark:bg-slate-900">
                  {suggestions.map((s) => (
                    <li key={s.label}>
                      <button type="button" className="w-full px-4 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { setLabel(s.label); if (s.type === type && s.categoryId) setCategoryId(s.categoryId); setWalletId(s.walletId); setLabelFocused(false); }}>
                        {s.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Field>
        )}

        {!showMore ? (
          <button type="button" className="text-sm text-brand" onClick={() => setShowMore(true)}>+ Note ou photo</button>
        ) : (
          <div className="space-y-3">
            <Field label="Note"><textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <div className="space-y-2">
              <span className="label">Photo</span>
              {existing?.photoPath && !pendingPhoto && (
                <div className="space-y-2">
                  <img src={existing.photoPath} alt="Ticket" className="max-h-64 rounded-xl" />
                  <button type="button" className="btn-danger w-full" onClick={() => removePhoto.mutate(existing.id)}>Retirer la photo</button>
                </div>
              )}
              {pendingPhoto && <p className="text-sm text-slate-500">Photo prête : {pendingPhoto.name}</p>}
              <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => setPendingPhoto(e.target.files?.[0] ?? null)} />
              <button type="button" className="btn-ghost w-full" onClick={() => fileRef.current?.click()}>📷 Joindre une photo</button>
            </div>
          </div>
        )}

        <ErrorBanner error={save.error || upload.error || confirmTx.error} />
        <button className="btn-primary w-full text-lg" disabled={!canSave || save.isPending || busy}>{editId ? "Enregistrer" : "Ajouter"}</button>
        {editId && (
          <button type="button" className="btn-danger w-full" onClick={async () => { if (confirm("Supprimer cette opération ?")) { await remove.mutateAsync(editId); navigate(-1); } }}>
            Supprimer
          </button>
        )}
      </form>
    </div>
  );
}
