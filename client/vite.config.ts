import { defineConfig } from "vite";

// Node global (the client tsconfig has no Node types).
declare const process: { env: Record<string, string | undefined> };

// Dev: the API (8080) and orchestrator (8081) sit behind this dev server so the
// browser sees one origin. The zone server WebSocket URL comes from /api/join.
// COMMONS_DEV_PORT_BASE moves the backends (e.g. 9000 → 9080…9083) so a
// second stack can run next to the usual one.
const base = Number(process.env.COMMONS_DEV_PORT_BASE ?? 8000);
const backend = (port: number) => `http://localhost:${base + port}`;

export default defineConfig({
  server: {
    port: Number(process.env.COMMONS_DEV_WEB_PORT ?? 5173),
    proxy: {
      "/api/join": backend(81),
      "/api/social": { target: backend(83), ws: true },
      "/api": backend(80),
    },
    fs: { allow: [".."] }, // maps live in ../assets
  },
  build: { target: "es2022", chunkSizeWarningLimit: 1200 },
});
