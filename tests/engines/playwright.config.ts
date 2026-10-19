// The cross-engine determinism check (shared Live design, P1; docs/PARITY.md): the same live run, with the same
// tweaks and a scrub back, must give the same run digests in Chromium, Firefox and WebKit as in Node. No server:
// each page runs one bundled script (build-harness.ts). Nightly only (it needs Firefox and WebKit installed).
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /\.spec\.ts$/,
  outputDir: "../.output/engines-results",
  globalSetup: "./build-harness.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 300_000,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
