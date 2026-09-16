import type { DB } from "../db.js";

/**
 * Journal de consommation de l'IA. Sans lui, personne ne sait ce que
 * l'application coûte réellement : toute estimation reste un calcul sur le
 * nombre de caractères. C'est aussi l'assiette de facturation d'un futur SaaS.
 */

/** Tarifs publiés, en dollars par million de jetons. */
const TARIFS: Record<string, { entree: number; sortie: number }> = {
  "claude-opus-5": { entree: 5, sortie: 25 },
  "claude-sonnet-5": { entree: 2, sortie: 10 },
  "claude-haiku-4-5": { entree: 1, sortie: 5 },
};

export interface AppelIa {
  modele: string;
  fonction: string;
  entree: number;
  sortie: number;
  ms: number;
}

export function logAiCall(db: DB, a: AppelIa): void {
  const t = TARIFS[a.modele];
  // Coût en millionièmes de dollar : un entier, donc pas d'arrondi qui dérive.
  const cout = t ? Math.round((a.entree * t.entree + a.sortie * t.sortie)) : 0;
  db.prepare(
    `INSERT INTO ai_calls (model, fonction, input_tokens, output_tokens, micro_usd, duree_ms)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(a.modele, a.fonction, a.entree, a.sortie, cout, Math.round(a.ms));
}

export interface ResumeIa {
  mois: string;
  appels: number;
  entree: number;
  sortie: number;
  /** Coût en centimes de dollar, pour rester en entiers comme les montants. */
  centsUsd: number;
  parFonction: { fonction: string; appels: number; centsUsd: number }[];
}

/** Consommation du mois en cours, et sa répartition par fonction. */
export function aiUsageSummary(db: DB, mois: string): ResumeIa {
  const total = db.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(input_tokens), 0) AS e, COALESCE(SUM(output_tokens), 0) AS s, COALESCE(SUM(micro_usd), 0) AS c
     FROM ai_calls WHERE substr(created_at, 1, 7) = ?`,
  ).get(mois) as { n: number; e: number; s: number; c: number };
  const parFonction = (db.prepare(
    `SELECT fonction, COUNT(*) AS n, COALESCE(SUM(micro_usd), 0) AS c FROM ai_calls
     WHERE substr(created_at, 1, 7) = ? GROUP BY fonction ORDER BY c DESC`,
  ).all(mois) as unknown as { fonction: string; n: number; c: number }[])
    .map((r) => ({ fonction: r.fonction, appels: r.n, centsUsd: Math.round(r.c / 10_000) }));
  return { mois, appels: total.n, entree: total.e, sortie: total.s, centsUsd: Math.round(total.c / 10_000), parFonction };
}

/** Enveloppe un appel pour le journaliser. Le journal ne doit jamais faire échouer une réponse. */
export async function mesurer<T extends { model: string; usage: { input_tokens: number; output_tokens: number } }>(
  db: DB,
  fonction: string,
  appel: () => Promise<T>,
): Promise<T> {
  const debut = Date.now();
  const reponse = await appel();
  try {
    logAiCall(db, {
      modele: reponse.model,
      fonction,
      entree: reponse.usage.input_tokens,
      sortie: reponse.usage.output_tokens,
      ms: Date.now() - debut,
    });
  } catch {
    /* journal indisponible : la réponse compte plus */
  }
  return reponse;
}
