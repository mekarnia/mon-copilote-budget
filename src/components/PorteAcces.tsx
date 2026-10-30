import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { executerEcheances } from "@/lib/backend";

export interface Membre { user_id: string; foyer_id: string; prenom: string; role: "proprietaire" | "membre" }

/** Le membre connecté (et donc son foyer), ou null s'il n'a pas encore de foyer. */
export function useMembre(userId: string | undefined) {
  return useQuery({
    queryKey: ["membre", userId],
    enabled: !!userId,
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await supabase.from("membres").select("*").eq("user_id", userId!).maybeSingle();
      if (error) throw new Error(error.message);
      return data as Membre | null;
    },
  });
}

/** La session Supabase, tenue à jour quand on se connecte ou se déconnecte. */
function useSession() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [recuperation, setRecuperation] = useState(false);
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((evenement, s) => {
      setSession(s);
      // Lien « mot de passe oublié » ouvert depuis l'e-mail : choisir le nouveau.
      if (evenement === "PASSWORD_RECOVERY") setRecuperation(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  return { session, recuperation, finRecuperation: () => setRecuperation(false) };
}

/**
 * Rien ne s'affiche tant que l'on n'est pas connecté et membre d'un foyer.
 *
 * Chacun a son compte (e-mail et mot de passe) ; le premier crée le foyer, le
 * second le rejoint avec le code d'invitation. Ensuite, les deux voient et
 * saisissent les mêmes dépenses, depuis n'importe où.
 */
export function PorteAcces({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { session, recuperation, finRecuperation } = useSession();
  const membre = useMembre(session?.user.id);
  const [echeancesFaites, setEcheancesFaites] = useState(false);

  // À l'ouverture, les échéances dues (loyer, abonnements) deviennent des opérations.
  useEffect(() => {
    if (!membre.data || echeancesFaites) return;
    setEcheancesFaites(true);
    void executerEcheances().then((n) => { if (n > 0) void qc.invalidateQueries(); }).catch(() => undefined);
  }, [membre.data, echeancesFaites, qc]);

  // Changer de compte ne doit jamais montrer les données du compte précédent.
  const precedent = useRef<string | undefined>(undefined);
  useEffect(() => {
    const id = session?.user.id;
    if (precedent.current && precedent.current !== id) qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "membre" });
    precedent.current = id;
  }, [session?.user.id, qc]);

  if (session === undefined) return <div className="p-6" aria-busy="true" />;
  if (recuperation && session) return <NouveauMotDePasse fini={finRecuperation} />;
  if (!session) return <Connexion />;
  if (membre.isLoading) return <div className="p-6" aria-busy="true" />;
  if (membre.error) return <Cadre titre="Connexion impossible"><p className="text-sm text-rose-600">{(membre.error as Error).message}</p></Cadre>;
  if (!membre.data) return <ChoixFoyer email={session.user.email ?? ""} apres={() => qc.invalidateQueries({ queryKey: ["membre"] })} />;
  return <>{children}</>;
}

function Connexion() {
  const [mode, setMode] = useState<"entrer" | "creer" | "oubli">("entrer");
  const [email, setEmail] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function envoyer(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    setInfo(null);
    setEnvoi(true);
    try {
      const retour = window.location.origin;
      if (mode === "entrer") {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: motDePasse });
        if (error) throw new Error(error.message === "Invalid login credentials" ? "E-mail ou mot de passe incorrect." : error.message);
      } else if (mode === "creer") {
        if (motDePasse.length < 8) throw new Error("Le mot de passe doit faire au moins 8 caractères.");
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password: motDePasse, options: { emailRedirectTo: retour } });
        if (error) throw new Error(error.message);
        if (!data.session) setInfo("Compte créé. Ouvrez l'e-mail de confirmation reçu, puis revenez vous connecter.");
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: retour });
        if (error) throw new Error(error.message);
        setInfo("Si ce compte existe, un e-mail vient de partir avec un lien pour choisir un nouveau mot de passe.");
      }
    } catch (e) {
      setErreur((e as Error).message);
    } finally {
      setEnvoi(false);
    }
  }

  const titres = { entrer: "Mon copilote budget", creer: "Créer mon compte", oubli: "Mot de passe oublié" };
  return (
    <Cadre titre={titres[mode]}>
      {mode === "creer" && (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Un compte par personne. Le premier crée le foyer ; le conjoint crée aussi son compte, puis rejoint le foyer avec le code d'invitation.
        </p>
      )}
      <form className="space-y-3" onSubmit={envoyer}>
        <input className="input" type="email" autoFocus autoComplete="email" inputMode="email" required
          value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Adresse e-mail" aria-label="Adresse e-mail" />
        {mode !== "oubli" && (
          <input className="input" type="password" required autoComplete={mode === "creer" ? "new-password" : "current-password"}
            value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)}
            placeholder={mode === "creer" ? "Mot de passe (8 caractères minimum)" : "Mot de passe"} aria-label="Mot de passe" />
        )}
        {erreur && <p className="text-sm font-medium text-rose-600">{erreur}</p>}
        {info && <p className="text-sm text-emerald-700 dark:text-emerald-400">{info}</p>}
        <button className="btn-primary w-full" disabled={envoi}>
          {envoi ? "…" : mode === "entrer" ? "Se connecter" : mode === "creer" ? "Créer le compte" : "Recevoir le lien"}
        </button>
      </form>
      <div className="flex flex-col gap-1 text-sm">
        {mode !== "entrer" && <button className="text-brand" onClick={() => setMode("entrer")}>J'ai déjà un compte</button>}
        {mode !== "creer" && <button className="text-brand" onClick={() => setMode("creer")}>Créer un compte</button>}
        {mode === "entrer" && <button className="text-slate-500" onClick={() => setMode("oubli")}>Mot de passe oublié ?</button>}
      </div>
      <p className="text-xs text-slate-500">La connexion reste active sur cet appareil : vous ne la retaperez pas à chaque ouverture.</p>
    </Cadre>
  );
}

function ChoixFoyer({ email, apres }: { email: string; apres: () => void }) {
  const [prenom, setPrenom] = useState("");
  const [code, setCode] = useState("");
  const [nom, setNom] = useState("Notre foyer");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function agir(action: "creer" | "rejoindre") {
    setErreur(null);
    if (!prenom.trim()) return setErreur("Indiquez votre prénom : il s'affiche à côté des dépenses que vous saisissez.");
    setEnvoi(true);
    const { error } = action === "creer"
      ? await supabase.rpc("creer_foyer", { p_nom: nom, p_prenom: prenom })
      : await supabase.rpc("rejoindre_foyer", { p_code: code, p_prenom: prenom });
    setEnvoi(false);
    if (error) return setErreur(error.message);
    apres();
  }

  return (
    <Cadre titre="Votre foyer">
      <p className="text-sm text-slate-600 dark:text-slate-300">Connecté avec {email}.</p>
      <input className="input" autoFocus value={prenom} onChange={(e) => setPrenom(e.target.value)} placeholder="Votre prénom" aria-label="Votre prénom" maxLength={40} />

      <section className="card space-y-3">
        <h2 className="font-semibold">Rejoindre le foyer de mon conjoint</h2>
        <p className="text-sm text-slate-500">Le code s'affiche chez lui ou chez elle, dans Réglages → Foyer.</p>
        <input className="input uppercase tracking-widest" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="Code d'invitation" aria-label="Code d'invitation" maxLength={8} autoCapitalize="characters" />
        <button className="btn-primary w-full" disabled={envoi || code.trim().length < 8} onClick={() => agir("rejoindre")}>Rejoindre</button>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Ou créer un nouveau foyer</h2>
        <input className="input" value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Nom du foyer" aria-label="Nom du foyer" maxLength={60} />
        <button className="btn-ghost w-full" disabled={envoi} onClick={() => agir("creer")}>Créer le foyer</button>
      </section>

      {erreur && <p className="text-sm font-medium text-rose-600">{erreur}</p>}
      <button className="text-sm text-slate-500" onClick={() => void supabase.auth.signOut()}>Changer de compte</button>
    </Cadre>
  );
}

function NouveauMotDePasse({ fini }: { fini: () => void }) {
  const [motDePasse, setMotDePasse] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  async function envoyer(e: React.FormEvent) {
    e.preventDefault();
    if (motDePasse.length < 8) return setErreur("Huit caractères au minimum.");
    const { error } = await supabase.auth.updateUser({ password: motDePasse });
    if (error) return setErreur(error.message);
    fini();
  }
  return (
    <Cadre titre="Nouveau mot de passe">
      <form className="space-y-3" onSubmit={envoyer}>
        <input className="input" type="password" autoFocus autoComplete="new-password" value={motDePasse}
          onChange={(e) => setMotDePasse(e.target.value)} placeholder="Nouveau mot de passe" aria-label="Nouveau mot de passe" />
        {erreur && <p className="text-sm font-medium text-rose-600">{erreur}</p>}
        <button className="btn-primary w-full">Enregistrer</button>
      </form>
    </Cadre>
  );
}

function Cadre({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-full max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-bold">{titre}</h1>
      {children}
    </div>
  );
}
