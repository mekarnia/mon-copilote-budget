import { serve } from "@hono/node-server";
import path from "node:path";
import { openDb } from "./db.js";
import { createApp } from "./app.js";
import { migrateKeyOutOfDb, setKeyFile } from "./services/ai.js";
import { motDePasseConfigure, setSessionFile } from "./services/session.js";
import { runDueRecurrences } from "./services/recurrences.js";

const root = path.resolve(import.meta.dirname, "..");
const dataDir = process.env.BUDGET_DATA_DIR ?? path.join(root, "data");
const port = Number(process.env.PORT ?? 3001);

const db = openDb(path.join(dataDir, "budget.sqlite"));
setKeyFile(path.join(dataDir, "cle-ia.txt"));
setSessionFile(path.join(dataDir, "acces.json"));
migrateKeyOutOfDb(db);

const app = createApp({ db, uploadsDir: path.join(dataDir, "uploads"), distDir: path.join(root, "dist") });

runDueRecurrences(db);
setInterval(() => runDueRecurrences(db), 60 * 60 * 1000);

const server = serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
  console.log(`Mon copilote budget : API sur http://localhost:${port} (données dans ${dataDir})`);
  // Dit à voix haute ce qui, sinon, se découvre le jour où c'est trop tard.
  console.log(motDePasseConfigure()
    ? "Accès protégé par mot de passe."
    : "Aucun mot de passe : l'application ne répond qu'au réseau local. Pour l'ouvrir sur le web, choisissez-en un depuis la maison ou définissez BUDGET_MOT_DE_PASSE.");
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\nLe port ${port} est déjà utilisé : une autre copie de l'application tourne déjà.`);
    console.error("Fermez les autres fenêtres qui la font tourner, ou arrêtez-les toutes :");
    console.error("  Windows : taskkill /F /IM node.exe");
    console.error("  macOS / Linux : pkill -f \"server/index.ts\"");
    console.error(`Vous pouvez aussi choisir un autre port : set PORT=3002 puis relancer.\n`);
    process.exit(1);
  }
  throw err;
});
