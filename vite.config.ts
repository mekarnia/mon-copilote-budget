import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";
import { execFileSync } from "node:child_process";

/** Version affichée dans Réglages : le commit construit, sans serveur pour la dire. */
function version() {
  const git = (...args: string[]) => {
    try {
      return execFileSync("git", args, { encoding: "utf8", timeout: 3000 }).trim();
    } catch {
      return "";
    }
  };
  return {
    commit: process.env.CF_PAGES_COMMIT_SHA?.slice(0, 7) || git("rev-parse", "--short", "HEAD") || "inconnu",
    date: git("log", "-1", "--format=%cd", "--date=format:%d/%m/%Y %H:%M"),
    construite: new Date().toLocaleString("fr-FR", { timeZone: "Africa/Algiers" }),
  };
}

export default defineConfig({
  define: { __VERSION__: JSON.stringify(version()) },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Mon copilote budget",
        short_name: "Budget",
        description: "Suivi du quotidien : dépenses, budgets, projets.",
        lang: "fr",
        theme_color: "#0f766e",
        background_color: "#f8fafc",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" },
        ],
      },
      workbox: {
        // Sans ces deux lignes, un ancien index.html pouvait rester en cache et
        // réclamer des fichiers JavaScript qui n'existent plus : page blanche.
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /^\/api\//,
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
  server: {
    port: 5180,
    proxy: {
      "/api": { target: "http://127.0.0.1:3001", changeOrigin: true },
      "/uploads": { target: "http://127.0.0.1:3001", changeOrigin: true },
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
