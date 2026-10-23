import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";
import app from "../../playwright.config";

// Reuse the app's production server and CSP; the determinism harness has no editor DOM.
// Run with E2E_TARGET=build and E2E_CHROMIUM_ONLY=1, plus explicit E2E ports.
export default defineConfig({
  ...app,
  testDir: "../e2e",
  testMatch: /connection-cancellation\.spec\.ts$/,
  outputDir: "../.output/engines-canvas-results",
  reporter: [["list"]],
  webServer: (Array.isArray(app.webServer) ? app.webServer : []).map((server) => ({
    ...server,
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
  })),
  projects: [
    { name: "firefox", use: { ...devices["Desktop Firefox"], launchOptions: {} } },
    { name: "webkit", use: { ...devices["Desktop Safari"], launchOptions: {} } },
  ],
});
