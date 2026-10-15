// The parity harness's browser tier (docs/PARITY.md): the production build (scripts/parity.mjs builds it into
// tests/.output/parity-dist, no test hooks) under `vite preview`, in Chromium at a fixed size, light scheme,
// reduced motion, English, UTC. No retries: a golden that needs a retry is a bug in the harness or the app.
import { defineConfig, devices } from "@playwright/test";

process.env.PARITY_TIER = "browser";

const port = Number(process.env.PARITY_PORT ?? 6200);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PARITY_PORT must be a port number");
const LOOPBACK = "127.0.0.1";

export default defineConfig({
  testDir: "./browser",
  testMatch: /\.parity\.ts$/,
  outputDir: "../.output/parity-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 3 : 4,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://localhost:${port}`,
    launchOptions: { args: [`--host-resolver-rules=MAP localhost ${LOOPBACK}`] },
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: "light",
    reducedMotion: "reduce",
    locale: "en-US",
    timezoneId: "UTC",
    testIdAttribute: "data-testid",
    acceptDownloads: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `pnpm exec vite preview --outDir tests/.output/parity-dist --host ${LOOPBACK} --port ${port} --strictPort`,
    cwd: "../..",
    url: `http://localhost:${port}`,
    env: { VITE_CONFIG_NATIVE_IGNORE_WARNING: "true" },
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
