/** Reconnaissance vocale native de Chrome Android. Renvoie null si le navigateur ne la propose pas. */
interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export function createRecognizer(): RecognitionLike | null {
  const w = window as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const r = new Ctor();
  r.lang = "fr-FR";
  r.interimResults = true;
  r.maxAlternatives = 1;
  return r;
}

export function transcriptOf(e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }): string {
  let text = "";
  for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
  return text.trim();
}
