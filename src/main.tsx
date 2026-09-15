import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { ErrorBoundary, reinitialiser } from "./components/ErrorBoundary";
import "./index.css";

registerSW({ immediate: true });

// Un fichier manquant vient d'un cache hors ligne périmé : l'application se
// répare elle-même au lieu de rester sur une page blanche. Une seule fois,
// sinon un vrai problème réseau ferait boucler le rechargement.
window.addEventListener("error", (e) => {
  const cible = e.target as HTMLScriptElement | HTMLLinkElement | null;
  const source = (cible as HTMLScriptElement)?.src ?? (cible as HTMLLinkElement)?.href;
  if (!source || document.body.innerText.trim().length > 0) return;
  if (new URLSearchParams(window.location.search).has("rechargement")) return;
  void reinitialiser();
}, true);

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
