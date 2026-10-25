import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
  // wasm-pack output must not be pre-bundled: it locates its .wasm via import.meta.url
  optimizeDeps: { exclude: ["widget-host-driver"] },
});
