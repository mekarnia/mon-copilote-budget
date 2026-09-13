import { useEffect, useRef, useState } from "react";
import { useChat, useClearChat, useSendChat } from "@/lib/queries";
import { ErrorBanner, useGoBack } from "@/components/ui";
import { WeeklyAdvicePanel } from "@/components/CoachCard";

const SUGGESTIONS = ["Combien en courses ce mois-ci ?", "Je peux me permettre 300 € de vélo ?", "Où je dépense le plus ?", "Combien mettre de côté ce mois-ci ?"];

export function CoachPage() {
  const goBack = useGoBack();
  const { data: messages = [] } = useChat();
  const send = useSendChat();
  const clear = useClearChat();
  const [text, setText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), [messages.length, send.isPending]);

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
        <button className="btn-ghost px-3 py-2" onClick={goBack} aria-label="Retour">‹</button>
        <h1 className="text-lg font-bold">Mon coach</h1>
        <button className="text-sm text-slate-500" onClick={() => { if (messages.length && confirm("Effacer la conversation ?")) clear.mutate(); }}>Effacer</button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto pb-4">
        {messages.length === 0 && <WeeklyAdvicePanel />}
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">Posez une question sur vos propres chiffres. Réponse courte, avec un montant.</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => <button key={s} className="chip bg-slate-100 dark:bg-slate-800" onClick={() => ask(s)}>{s}</button>)}
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
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Votre question…" disabled={send.isPending} />
        <button className="btn-primary" disabled={!text.trim() || send.isPending}>➤</button>
      </form>
    </div>
  );
}
