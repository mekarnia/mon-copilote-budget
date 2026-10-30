// Point d'entrée Supabase (Deno) de la fonction « ia ». Toute la logique est
// dans logique.ts ; ce fichier ne fait que brancher Supabase et Anthropic.
import Anthropic from "npm:@anthropic-ai/sdk@0.125.0";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { traiter, type Anthropique, type Base } from "./logique.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sansSession = { auth: { persistSession: false, autoRefreshToken: false } };

const admin = createClient(url, service, sansSession) as unknown as Base;

Deno.serve((req) =>
  traiter(req, {
    utilisateur: (autorisation) => createClient(url, anon, { ...sansSession, global: { headers: { Authorization: autorisation } } }) as unknown as Base,
    admin,
    anthropic: (cle) => new Anthropic({ apiKey: cle }) as unknown as Anthropique,
  })
);
