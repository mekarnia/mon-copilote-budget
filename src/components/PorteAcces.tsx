import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

interface EtatSession {
  /** Un mot de passe a déjà été choisi. */
  configure: boolean;
  connecte: boolean;
  /** L'appel vient du réseau de la maison. */
  local: boolean;
}

/**
 * Rien ne s'affiche tant que la porte n'est pas ouverte.
 *
 * À la maison, sans mot de passe configuré, l'application s'ouvre directement :
 * en taper un pour noter une baguette serait absurde. Dès qu'un mot de passe
 * existe — c'est-à-dire dès que l'application est en ligne — il est demandé.
 */
export function PorteAcces({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["session"],
    queryFn: () => api.get<EtatSession>("/api/session"),
    retry: false,
    staleTime: 60_000,
  });

  if (isLoading || !data) return <div className="p-6" aria-busy="true" />;
  if (data.connecte || (!data.configure && data.local)) return <>{children}</>;
  return <Connexion etat={data} apresEntree={() => qc.invalidateQueries()} />;
}

function Connexion({ etat, apresEntree }: { etat: EtatSession; apresEntree: () => void }) {
  const premiereFois = !etat.configure;
  const [motDePasse, setMotDePasse] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  // Sans mot de passe et hors du réseau local, il n'y a rien à proposer :
  // le choisir depuis l'extérieur reviendrait à offrir le compte au premier venu.
  if (premiereFois && !etat.local) {
    return (
      <Cadre titre="Application verrouillée">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Aucun mot de passe n'a encore été choisi. Pour des raisons de sécurité, il doit l'être depuis le réseau de la
          maison, ou fourni par l'hébergeur au démarrage du serveur.
        </p>
      </Cadre>
    );
  }

  async function envoyer(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    if (premiereFois && motDePasse !== confirmation) return setErreur("Les deux mots de passe ne sont pas identiques.");
    setEnvoi(true);
    try {
      await api.post("/api/session", premiereFois ? { nouveau: motDePasse } : { motDePasse });
      apresEntree();
    } catch (e) {
      setErreur((e as Error).message);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Cadre titre={premiereFois ? "Choisissez un mot de passe" : "Mon copilote budget"}>
      {premiereFois && (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Il protégera vos comptes sur tous les appareils. Huit caractères au minimum. Notez-le : il n'existe aucun moyen
          de le retrouver.
        </p>
      )}
      <form className="space-y-3" onSubmit={envoyer}>
        <input
          className="input" type="password" autoFocus autoComplete={premiereFois ? "new-password" : "current-password"}
          value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} placeholder="Mot de passe"
          aria-label="Mot de passe"
        />
        {premiereFois && (
          <input
            className="input" type="password" autoComplete="new-password" value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)} placeholder="Confirmez le mot de passe"
            aria-label="Confirmez le mot de passe"
          />
        )}
        {erreur && <p className="text-sm font-medium text-rose-600">{erreur}</p>}
        <button className="btn-primary w-full" disabled={envoi || motDePasse.length < 1}>
          {envoi ? "…" : premiereFois ? "Enregistrer et entrer" : "Entrer"}
        </button>
      </form>
      <p className="text-xs text-slate-500">
        La connexion reste valable trois mois sur cet appareil : sur votre téléphone, vous ne le retaperez pas tous les jours.
      </p>
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
