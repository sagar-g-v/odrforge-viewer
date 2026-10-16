/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // pre-bundle the map stack together so MapLibre and deck.gl share one copy of their common modules
  optimizeDeps: { include: ["maplibre-gl", "@deck.gl/core", "@deck.gl/layers", "@deck.gl/mapbox", "@deck.gl/extensions", "proj4"] },
  worker: { format: "es" },
  // MapLibre GL (~0.8 MB) and deck.gl (~1.2 MB) are the bulk of the bundle; both are needed before the first frame
  build: { chunkSizeWarningLimit: 2600 },
  test: { environment: "node", exclude: ["**/node_modules/**", "**/.claude/**"] }, // .claude: other sessions' worktrees
});
