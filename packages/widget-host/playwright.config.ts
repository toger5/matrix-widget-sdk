import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests of the host in DevBackend mode (no homeserver). See "Playwright tests" in
 * implementationPlan.md: one page per worker, repopulated from a seed before every test.
 */
export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.spec.ts",
  outputDir: "test-results",
  // Tests of one file share a page, so they run in order; files run in parallel workers.
  fullyParallel: false,
  workers: process.env.CI ? 2 : 4,
  timeout: 15_000,
  expect: { timeout: 4_000 },
  reporter: [["list"]],
  use: { baseURL: "http://localhost:5173", ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
  webServer: [
    { command: "npm run dev", url: "http://localhost:5173", reuseExistingServer: true, timeout: 60_000 },
    { command: "npm run dev -w @matrix-widget-tools/test-widgets", url: "http://localhost:5175/new/", reuseExistingServer: true, timeout: 60_000, cwd: "../.." },
  ],
});
