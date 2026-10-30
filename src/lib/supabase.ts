import { createClient } from "@supabase/supabase-js";

/**
 * Le client Supabase du foyer.
 *
 * L'adresse et la clé publiable sont publiques par construction : elles ne
 * donnent accès à rien sans compte connecté, et la sécurité par ligne limite
 * chaque compte à son foyer. Les secrets (clé Anthropic) restent côté serveur.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const cle = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

if (!url || !cle) {
  throw new Error("VITE_SUPABASE_URL et VITE_SUPABASE_PUBLISHABLE_KEY doivent être définis (fichier .env).");
}

export const supabase = createClient(url, cle, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // Lien de confirmation ou de réinitialisation ouvert depuis l'e-mail.
    detectSessionInUrl: true,
  },
});
