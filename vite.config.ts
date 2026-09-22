import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { localFunctions } from "./scripts/local-functions/vite-plugin";

export default defineConfig({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  // localFunctions is dev-only and inert unless VITE_LOCAL_FUNCTIONS=1 — see
  // scripts/local-functions/vite-plugin.ts.
  plugins: [react(), localFunctions()],
  optimizeDeps: {
    // Dependencies reached only through lazily loaded pages are discovered on
    // first visit, and Vite reloads the page to re-optimise. The QBank player
    // is one of those pages, so that reload landed mid-session. Pre-bundling
    // them at startup keeps the first visit from reloading.
    include: ["@radix-ui/react-popover", "@radix-ui/react-alert-dialog", "@radix-ui/react-tabs"],
  },
  build: {
    rollupOptions: {
      output: {
        // Split the largest shared vendors into their own cacheable chunks so
        // the entry bundle stays under the 500 kB warning threshold.
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          supabase: ["@supabase/supabase-js"],
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
    ],
  },
});
