import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { ApiError, lireFlux } from "../src/lib/api.js";

let serveur: Server | null = null;

/** Sert une réponse en morceaux, découpés là où ça fait mal. */
function servir(morceaux: string[], statut = 200, entetes: Record<string, string> = { "content-type": "text/event-stream" }): Promise<string> {
  return new Promise((resoudre) => {
    serveur = createServer((_req, res) => {
      res.writeHead(statut, entetes);
      for (const m of morceaux) res.write(m);
      res.end();
    });
    serveur.listen(0, "127.0.0.1", () => {
      const a = serveur!.address();
      resoudre(`http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}/`);
    });
  });
}

afterEach(() => {
  serveur?.close();
  serveur = null;
});

describe("lecture d'une réponse envoyée par morceaux", () => {
  it("rassemble le texte, même coupé au milieu d'un événement", async () => {
    // Le découpage réseau ne respecte pas les événements : un « data: » peut
    // arriver en deux paquets. Sans tampon, la moitié du mot est perdue.
    const url = await servir([
      'event: morceau\ndata: "Vous pouvez ',
      'épargner "\n\nevent: morceau\ndata: "12 000 DA."\n\n',
      'event: fin\ndata: {"id":7,"role":"assistant","content":"Vous pouvez épargner 12 000 DA."}\n\n',
    ]);
    let texte = "";
    let fin: unknown = null;
    await lireFlux(url, { message: "?" }, {
      morceau: (m) => { texte += String(m); },
      fin: (m) => { fin = m; },
    });
    expect(texte).toBe("Vous pouvez épargner 12 000 DA.");
    expect(fin).toMatchObject({ id: 7, content: "Vous pouvez épargner 12 000 DA." });
  });

  it("remonte l'erreur envoyée dans le flux", async () => {
    const url = await servir(['event: erreur\ndata: "Plafond IA du mois atteint."\n\n']);
    let recue = "";
    await lireFlux(url, {}, { erreur: (m) => { recue = String(m); } });
    expect(recue).toBe("Plafond IA du mois atteint.");
  });

  it("remonte l'erreur quand le serveur refuse avant d'ouvrir le flux", async () => {
    const url = await servir(['{"error":"Trop de demandes à l\'IA en une minute."}'], 429, { "content-type": "application/json" });
    await expect(lireFlux(url, {}, {})).rejects.toThrow(/Trop de demandes/);
    await expect(lireFlux(url, {}, {})).rejects.toBeInstanceOf(ApiError);
  });

  it("ignore un événement illisible au lieu d'interrompre la réponse", async () => {
    const url = await servir(["event: morceau\ndata: ceci n'est pas du JSON\n\n", 'event: morceau\ndata: "la suite"\n\n']);
    let texte = "";
    await lireFlux(url, {}, { morceau: (m) => { texte += String(m); } });
    expect(texte).toBe("la suite");
  });
});
