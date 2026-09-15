import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Version réellement en cours d'exécution. Sans elle, impossible de savoir si un
 * correctif publié est bien celui qui tourne : on débogue à l'aveugle.
 */
export function versionInfo(racine: string): { commit: string; date: string; interfaceLe: string } {
  let commit = "inconnu";
  let date = "";
  try {
    commit = execFileSync("git", ["-C", racine, "rev-parse", "--short", "HEAD"], { encoding: "utf8", timeout: 3000 }).trim();
    date = execFileSync("git", ["-C", racine, "log", "-1", "--format=%cd", "--date=format:%d/%m/%Y %H:%M"], { encoding: "utf8", timeout: 3000 }).trim();
  } catch {
    /* dépôt absent ou git non installé */
  }
  let interfaceLe = "";
  try {
    interfaceLe = new Date(fs.statSync(path.join(racine, "dist", "index.html")).mtimeMs).toLocaleString("fr-FR");
  } catch {
    /* interface jamais construite */
  }
  return { commit, date, interfaceLe };
}
