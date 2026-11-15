import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
  // The bindings load their .wasm by URL at runtime; keep them out of dependency pre-bundling.
  optimizeDeps: { exclude: ["@matrix-widget-tools/widget-host-bindings"] },
  build: {
    rollupOptions: {
      // `index.html` is the app; `oidc-callback.html` the OAuth redirect target, which runs in the login popup;
      // `widget_compatibility_wrapper/` the compat wrapper (`../widget-compat-wrapper`) for legacy widgets.
      input: ["index.html", "oidc-callback.html", "widget_compatibility_wrapper/index.html"],
    },
  },
});
