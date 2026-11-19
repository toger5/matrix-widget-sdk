import { defineConfig } from "@playwright/test";

import base from "./playwright.config";

/** `npm run widget-shots`: screenshots of the test widgets (e2e/tools/widgetShots.ts), with the servers of the e2e tests. */
export default defineConfig({
  ...base,
  testDir: "e2e/tools",
  testMatch: "widgetShots.ts",
  workers: 1,
  timeout: 30_000,
});
