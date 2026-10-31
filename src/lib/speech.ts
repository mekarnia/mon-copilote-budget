/**
 * Dictée avec la reconnaissance vocale du navigateur (Chrome, Safari récent).
 *
 * Laissée à elle-même, la reconnaissance s'arrête à la première hésitation :
 * « 1200 dinars… de courses » perdait la fin. Ici, l'écoute est continue et
 * repart toute seule si le navigateur la coupe ; elle ne se termine que sur
 * « Terminer », ou après un vrai silence une fois que quelque chose a été dit.
 */
interface ResultatVocal { isFinal: boolean; 0: { transcript: string } }
interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ResultatVocal> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type Constructeur = new () => RecognitionLike;
const constructeur = (): Constructeur | null => {
  const w = globalThis as unknown as { SpeechRecognition?: Constructeur; webkitSpeechRecognition?: Constructeur };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export const dicteeDisponible = () => constructeur() !== null;

/** Silence accepté entre deux morceaux de phrase, une fois qu'on a commencé à parler. */
export const SILENCE_MS = 2500;
/** Si rien n'est dit du tout, on n'écoute pas indéfiniment. */
const ATTENTE_MAX_MS = 10_000;

export interface Ecoute {
  /** Termine tout de suite et rend le texte entendu. */
  terminer(): void;
  /** Abandonne sans rien rendre. */
  annuler(): void;
}

const mots = (s: string) => s.trim().split(/\s+/).filter(Boolean);
const egal = (a: string, b: string) => a.toLowerCase().replace(/[.,!?;:]/g, "") === b.toLowerCase().replace(/[.,!?;:]/g, "");

/**
 * Raccorde deux morceaux de phrase sans répéter ce qu'ils ont en commun.
 *
 * Chrome sur Android renvoie souvent la phrase entière à chaque nouveau morceau
 * (« 1200 », puis « 1200 dinars », puis « 1200 dinars de courses »), et redit
 * parfois la fin du morceau précédent après une reprise. Mis bout à bout, cela
 * donnait « 1200 1200 dinars 1200 dinars de courses ». On garde le plus long
 * morceau qui contient l'autre, sinon on recolle sur le plus grand chevauchement.
 */
export function fusionner(a: string, b: string): string {
  const A = mots(a), B = mots(b);
  if (!A.length) return B.join(" ");
  if (!B.length) return A.join(" ");
  const contient = (x: string[], y: string[]) => {
    for (let i = 0; i + y.length <= x.length; i++) if (y.every((m, j) => egal(m, x[i + j]))) return true;
    return false;
  };
  if (contient(B, A)) return B.join(" ");
  if (contient(A, B)) return A.join(" ");
  for (let n = Math.min(A.length, B.length); n > 0; n--) {
    if (A.slice(-n).every((m, j) => egal(m, B[j]))) return [...A, ...B.slice(n)].join(" ");
  }
  return [...A, ...B].join(" ");
}

export function ecouter(rappels: {
  /** Le texte entendu jusqu'ici, mis à jour pendant qu'on parle. */
  auFil: (texte: string) => void;
  /** Le texte complet, une seule fois, à la fin. */
  fin: (texte: string) => void;
  erreur?: (message: string) => void;
}): Ecoute | null {
  const Ctor = constructeur();
  if (!Ctor) return null;
  let acquis = "";          // texte définitif des sessions précédentes
  let session = "";         // texte définitif de la session en cours
  let provisoire = "";      // ce que le moteur hésite encore à confirmer
  let fini = false;
  let relances = 0;
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  let r: RecognitionLike;

  const texte = () => fusionner(fusionner(acquis, session), provisoire);
  const armer = (ms: number) => {
    clearTimeout(minuterie);
    minuterie = setTimeout(() => terminer(), ms);
  };

  function terminer() {
    if (fini) return;
    fini = true;
    clearTimeout(minuterie);
    try { r.stop(); } catch { /* déjà arrêtée */ }
    rappels.fin(texte());
  }

  function demarrer() {
    r = new Ctor!();
    r.lang = "fr-FR";
    // Écoute continue : moins de reprises, donc moins de « bip » du micro sur Android.
    // Ses résultats répétés sont raccordés par fusionner().
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      let definitif = "", hesitant = "";
      for (let i = 0; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) definitif = fusionner(definitif, t); else hesitant = fusionner(hesitant, t);
      }
      session = definitif;
      provisoire = hesitant;
      rappels.auFil(texte());
      armer(SILENCE_MS);
    };
    r.onerror = (e) => {
      // « no-speech » et « aborted » ne sont que des pauses : la session repart dans onend.
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        fini = true;
        clearTimeout(minuterie);
        rappels.erreur?.("Micro refusé : autorisez-le pour ce site dans les réglages du navigateur.");
      } else if (e.error === "network") {
        fini = true;
        clearTimeout(minuterie);
        rappels.erreur?.("La dictée du navigateur a besoin d'internet. Réessayez, ou utilisez « Décrire ».");
      }
    };
    r.onend = () => {
      if (fini) return;
      // Le navigateur a coupé de lui-même : on garde ce qui est acquis et on repart.
      // Le provisoire n'est gardé que s'il n'a jamais été confirmé : sinon il reviendrait en double.
      acquis = fusionner(acquis, session || provisoire);
      session = provisoire = "";
      if (relances++ > 30) return terminer();
      try { demarrer(); } catch { terminer(); }
    };
    r.start();
  }

  demarrer();
  armer(ATTENTE_MAX_MS);
  return {
    terminer,
    annuler() {
      fini = true;
      clearTimeout(minuterie);
      try { r.abort(); } catch { /* déjà arrêtée */ }
    },
  };
}
