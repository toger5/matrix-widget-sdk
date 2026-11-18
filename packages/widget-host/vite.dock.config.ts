/// <reference types="node" />
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * `npm run dock`: the playground of the DockArea (src/views/dock/), a test target of its own with fake
 * windows and tabs. It loads none of the app (no bindings, no session).
 */
export default defineConfig({
  root: join(dirname(fileURLToPath(import.meta.url)), "dock-playground"),
  plugins: [react()],
  server: { port: 5174, strictPort: true },
});
