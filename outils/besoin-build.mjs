// Répond 1 s'il faut reconstruire l'interface, 0 sinon.
// Sans cela, demarrer.bat reconstruisait à chaque lancement, ou pire, gardait
// une interface périmée après un « git pull » — dist n'étant pas suivi par git.
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const racine = new URL("..", import.meta.url).pathname;

// Mode « dépendances » : 1 s'il faut relancer npm install.
if (process.argv[2] === "--deps") {
  const marque = join(racine, "node_modules", ".package-lock.json");
  const verrou = join(racine, "package-lock.json");
  if (!existsSync(marque) || !existsSync(verrou)) process.exit(1);
  process.exit(statSync(verrou).mtimeMs > statSync(marque).mtimeMs ? 1 : 0);
}
const repere = join(racine, "dist", "index.html");
if (!existsSync(repere)) process.exit(1);

const construitLe = statSync(repere).mtimeMs;
const sources = ["src", "shared", "index.html", "package.json", "tailwind.config.js", "vite.config.ts", "postcss.config.js"];

function plusRecent(chemin) {
  if (!existsSync(chemin)) return 0;
  const info = statSync(chemin);
  if (!info.isDirectory()) return info.mtimeMs;
  let max = info.mtimeMs;
  for (const nom of readdirSync(chemin)) max = Math.max(max, plusRecent(join(chemin, nom)));
  return max;
}

const modifieLe = Math.max(...sources.map((s) => plusRecent(join(racine, s))));
process.exit(modifieLe > construitLe ? 1 : 0);
