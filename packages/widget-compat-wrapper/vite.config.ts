import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative asset paths: a host may serve the built wrapper under a sub-path (e.g. `/widgets/compat-wrapper/`).
  base: "./",
  server: { port: 5174, strictPort: true },
  preview: { port: 5174, strictPort: true },
  test: { environment: "node" },
});
