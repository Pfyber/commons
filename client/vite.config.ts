import { defineConfig } from "vite";

// Dev: the API (8080) and orchestrator (8081) sit behind this dev server so the
// browser sees one origin. The zone server WebSocket URL comes from /api/join.
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/api/join": "http://localhost:8081",
      "/api/social": { target: "http://localhost:8083", ws: true },
      "/api": "http://localhost:8080",
    },
    fs: { allow: [".."] }, // maps live in ../assets
  },
  build: { target: "es2022", chunkSizeWarningLimit: 1200 },
});
