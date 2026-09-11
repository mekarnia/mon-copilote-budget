import { serve } from "@hono/node-server";
import path from "node:path";
import { openDb } from "./db.js";
import { createApp } from "./app.js";
import { runDueRecurrences } from "./services/recurrences.js";

const root = path.resolve(import.meta.dirname, "..");
const dataDir = process.env.BUDGET_DATA_DIR ?? path.join(root, "data");
const port = Number(process.env.PORT ?? 3001);

const db = openDb(path.join(dataDir, "budget.sqlite"));
const app = createApp({ db, uploadsDir: path.join(dataDir, "uploads"), distDir: path.join(root, "dist") });

runDueRecurrences(db);
setInterval(() => runDueRecurrences(db), 60 * 60 * 1000);

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
  console.log(`Mon copilote budget : API sur http://localhost:${port} (données dans ${dataDir})`);
});
