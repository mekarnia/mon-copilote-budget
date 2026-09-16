import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useChat, useClearChat, useSendChatStream, useSettings } from "@/lib/queries";
import { Bandeau, ErrorBanner, useGoBack } from "@/components/ui";
import { IconLeft, IconSend } from "@/components/icons";
import { WeeklyAdvicePanel } from "@/components/CoachCard";

const SUGGESTIONS = ["Combien je peux épargner ce mois-ci ?", "Quelle dépense dérive le plus ?", "Je peux me permettre 25 000 DA ?", "Où j'en serais dans un an à ce rythme ?"];

export function CoachPage() {
  const goBack = useGoBack();
  const { data: messages = [] } = useChat();
  const { data: settings } = useSettings();
  // Le coach passe par l'IA : sans clé, autant le dire tout de suite plutôt qu'après la question.
  const sansCle = settings !== undefined && !settings.aiKey;
  const send = useSendChatStream();
  const clear = useClearChat();
  const [text, setText] = useState("");
  // La question posée et la réponse en cours d'écriture, affichées avant que le
  // serveur ne les ait enregistrées : sinon l'écran ne bouge pas pendant l'attente.
  const [enCours, setEnCours] = useState<{ question: string; reponse: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, enCours?.reponse]);

  async function ask(q: string) {
    const msg = q.trim();
    if (!msg) return;
    setText("");
    setEnCours({ question: msg, reponse: "" });
    try {
      await send.mutateAsync({
        message: msg,
        onDelta: (morceau) => setEnCours((e) => (e ? { ...e, reponse: e.reponse + morceau } : e)),
      });
    } catch {
      setText(msg);
    } finally {
      setEnCours(null);
    }
  }

  return (
    <div className="mx-auto flex min-h-full max-w-lg flex-col px-4 pb-4 pt-4">
      <Bandeau>
        <div className="flex items-center justify-between">
          <button className="-ml-2 flex size-11 items-center justify-center text-white/80" onClick={goBack} aria-label="Retour"><IconLeft size={22} /></button>
          <span className="text-[17px] font-semibold">Mon coach</span>
          <button
            className="-mr-2 flex h-11 items-center px-2 text-sm font-medium text-white/80 disabled:opacity-40"
            disabled={messages.length === 0}
            onClick={() => { if (confirm("Effacer la conversation ?")) clear.mutate(); }}
          >
            Effacer
          </button>
        </div>
      </Bandeau>

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
        {enCours && (
          <>
            <div className="flex justify-end"><div className="max-w-[85%] rounded-2xl bg-brand px-4 py-2 text-sm leading-relaxed text-white">{enCours.question}</div></div>
            <div className="flex justify-start">
              <div className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm leading-relaxed shadow-sm ${enCours.reponse ? "bg-white dark:bg-slate-900" : "bg-white text-slate-500 dark:bg-slate-900"}`}>
                {enCours.reponse || "Je regarde vos chiffres…"}
              </div>
            </div>
          </>
        )}
        <ErrorBanner error={send.error} />
        <div ref={bottomRef} />
      </div>

      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={sansCle ? "Clé IA requise" : "Votre question…"} disabled={send.isPending || sansCle} />
        <button className="btn-primary shrink-0 px-4" aria-label="Envoyer la question" disabled={!text.trim() || send.isPending || sansCle}><IconSend size={19} /></button>
      </form>
    </div>
  );
}
