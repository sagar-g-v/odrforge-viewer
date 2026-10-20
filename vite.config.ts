/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // pre-bundle the map stack together so MapLibre and deck.gl share one copy of their common modules
  optimizeDeps: { include: ["maplibre-gl", "@deck.gl/core", "@deck.gl/layers", "@deck.gl/mapbox", "@deck.gl/extensions", "proj4"] },
  worker: { format: "es" },
  // CARTO_MAP_API (environment): the CARTO basemaps key, read by the client as import.meta.env.CARTO_MAP_API. Vite only
  // exposes variables with these prefixes, so nothing else from the environment reaches the bundle
  envPrefix: ["VITE_", "CARTO_MAP_API"],
  // MapLibre GL (~0.8 MB) and deck.gl (~1.2 MB) are the bulk of the bundle; both are needed before the first frame, so
  // they are not lazy-loaded, but each library gets its own chunk: they download in parallel and stay cached when only
  // the viewer's own code changes
  build: {
    chunkSizeWarningLimit: 1500,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "maplibre", test: /node_modules[\/]maplibre-gl[\/]/ },
            { name: "deckgl", test: /node_modules[\/](@deck\.gl|@luma\.gl|@math\.gl|@loaders\.gl|@probe\.gl|earcut)[\/]/ },
            { name: "proj4", test: /node_modules[\/](proj4|mgrs|wkt-parser)[\/]/ },
            { name: "react", test: /node_modules[\/](react|react-dom|scheduler)[\/]/ },
          ],
        },
      },
    },
  },
  test: { environment: "node", exclude: ["**/node_modules/**", "**/.claude/**"] }, // .claude: other sessions' worktrees
});
