import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useChat, useClearChat, useSendChat, useSettings } from "@/lib/queries";
import { ErrorBanner, useGoBack } from "@/components/ui";
import { WeeklyAdvicePanel } from "@/components/CoachCard";

const SUGGESTIONS = ["Combien je peux épargner ce mois-ci ?", "Quelle dépense dérive le plus ?", "Je peux me permettre 25 000 DA ?", "Où j'en serais dans un an à ce rythme ?"];

export function CoachPage() {
  const goBack = useGoBack();
  const { data: messages = [] } = useChat();
  const { data: settings } = useSettings();
  // Le coach passe par l'IA : sans clé, autant le dire tout de suite plutôt qu'après la question.
  const sansCle = settings !== undefined && !settings.aiKey;
  const send = useSendChat();
  const clear = useClearChat();
  const [text, setText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, send.isPending]);

  async function ask(q: string) {
    const msg = q.trim();
    if (!msg) return;
    setText("");
    try {
      await send.mutateAsync(msg);
    } catch {
      setText(msg);
    }
  }

  return (
    <div className="mx-auto flex min-h-full max-w-lg flex-col px-4 pb-4 pt-4">
      <div className="mb-3 flex items-center justify-between">
        <button className="btn-ghost size-11 p-0" onClick={goBack} aria-label="Retour">‹</button>
        <h1 className="text-lg font-bold">Mon coach</h1>
        <button className="flex h-11 items-center px-2 text-sm font-medium text-slate-500" onClick={() => { if (messages.length && confirm("Effacer la conversation ?")) clear.mutate(); }}>Effacer</button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto pb-4">
        {sansCle && (
          <div className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            Le coach répond grâce à l'IA : il lui faut votre clé Anthropic pour lire vos chiffres et vous répondre.
            {" "}<Link to="/reglages/sauvegarde" className="inline-flex h-11 items-center font-semibold underline">L'ajouter dans Réglages</Link>. Tout le reste de l'application fonctionne sans.
          </div>
        )}
        {messages.length === 0 && <WeeklyAdvicePanel />}
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">Posez une question sur vos propres chiffres. Réponse en trois phrases, avec un montant. Le coach se souvient de vos échanges précédents.</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => <button key={s} className="flex h-11 items-center rounded-full bg-slate-100 px-4 text-sm font-medium disabled:opacity-40 dark:bg-slate-800" disabled={sansCle} onClick={() => ask(s)}>{s}</button>)}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm leading-relaxed ${m.role === "user" ? "bg-brand text-white" : "bg-white shadow-sm dark:bg-slate-900"}`}>{m.content}</div>
          </div>
        ))}
        {send.isPending && <div className="flex justify-start"><div className="rounded-2xl bg-white px-4 py-2 text-sm text-slate-500 shadow-sm dark:bg-slate-900">Je regarde vos chiffres…</div></div>}
        <ErrorBanner error={send.error} />
        <div ref={bottomRef} />
      </div>

      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={sansCle ? "Clé IA requise" : "Votre question…"} disabled={send.isPending || sansCle} />
        <button className="btn-primary" disabled={!text.trim() || send.isPending || sansCle}>➤</button>
      </form>
    </div>
  );
}
