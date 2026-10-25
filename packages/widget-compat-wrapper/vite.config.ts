import { defineConfig } from "vitest/config";

export default defineConfig({
  server: { port: 5174, strictPort: true },
  preview: { port: 5174, strictPort: true },
  test: { environment: "node" },
});
