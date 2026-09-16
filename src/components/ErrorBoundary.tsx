import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Une erreur d'affichage laissait une page entièrement blanche : aucune
 * indication, aucun moyen de s'en sortir. Elle affiche désormais la cause et
 * propose la réparation qui marche dans la quasi-totalité des cas — vider le
 * cache hors ligne, qui garde parfois une ancienne version incompatible.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { erreur: Error | null }> {
  override state: { erreur: Error | null } = { erreur: null };

  static getDerivedStateFromError(erreur: Error) {
    return { erreur };
  }

  override componentDidCatch(erreur: Error, info: ErrorInfo) {
    console.error("Écran en erreur :", erreur, info.componentStack);
  }

  override render() {
    if (!this.state.erreur) return this.props.children;
    return (
      <div className="mx-auto flex min-h-full max-w-lg flex-col justify-center gap-4 p-6">
        <h1 className="text-xl font-bold">L'écran n'a pas pu s'afficher</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          C'est presque toujours une ancienne version gardée en mémoire par le navigateur. Le bouton ci-dessous
          l'efface et recharge l'application. Vos données ne sont pas touchées : elles sont sur le serveur, pas dans
          le navigateur.
        </p>
        <button className="btn-primary" onClick={reinitialiser}>Vider le cache et recharger</button>
        <button className="btn-ghost" onClick={() => window.location.reload()}>Recharger simplement</button>
        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer py-2">Détail technique</summary>
          <pre className="overflow-x-auto whitespace-pre-wrap pt-2">{this.state.erreur.message}</pre>
        </details>
      </div>
    );
  }
}

/** Retire le service worker et tous les caches, puis recharge depuis le serveur. */
export async function reinitialiser() {
  try {
    const sws = await navigator.serviceWorker?.getRegistrations?.();
    await Promise.all((sws ?? []).map((r) => r.unregister()));
  } catch {
    /* pas de service worker : rien à faire */
  }
  try {
    const noms = await caches.keys();
    await Promise.all(noms.map((n) => caches.delete(n)));
  } catch {
    /* pas d'API caches : rien à faire */
  }
  window.location.replace(window.location.pathname + "?rechargement=" + Date.now());
}
