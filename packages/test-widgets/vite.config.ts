import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5175, strictPort: true },
  preview: { port: 5175, strictPort: true },
  optimizeDeps: { exclude: ["@matrix-widget-sdk/widget"] },
  build: { rollupOptions: { input: { index: "index.html", legacy: "legacy/index.html", new: "new/index.html" } } },
});
