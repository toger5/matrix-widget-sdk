import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
  // The bindings load their .wasm by URL at runtime; keep them out of dependency pre-bundling.
  optimizeDeps: { exclude: ["@matrix-widget-tools/widget-host-bindings"] },
});
