import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config. Two projects:
 *  - "chromium": every spec in tests/e2e against the Vite dev server (port E2E_PORT, default 5191).
 *  - "subpath":  tests/e2e/subpath.spec.ts against a production build served by `vite preview`
 *                under /tools/diagrams/ (port E2E_PREVIEW_PORT, default 5193), proving the build embeds
 *                under a sub-path.
 *
 * Ports: set E2E_PORT / E2E_PREVIEW_PORT to run beside another checkout's servers. A running server is
 * reused only when its port was chosen explicitly, or locally (not on CI) on the default port, so a CI run
 * never silently tests a server it didn't start.
 * Skip the production-build server locally with E2E_SKIP_PREVIEW=1 (saves a build per run).
 * Every test gets a fresh browser context, so localStorage (settings, autosave) starts empty.
 * All outputs live in tests/.output (gitignored by tests/.gitignore).
 */
const CI = !!process.env.CI;

/** A port from the environment, or the default; `explicit` says whether the caller chose it. */
function port(name: string, fallback: number): { port: number; explicit: boolean } {
  const raw = process.env[name];
  if (!raw) return { port: fallback, explicit: false };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`${name} must be a port number, got "${raw}"`);
  return { port: n, explicit: true };
}
const dev = port("E2E_PORT", 5191);
const preview = port("E2E_PREVIEW_PORT", 5193);
const DEV_PORT = dev.port;
const PREVIEW_PORT = preview.port;
export const PREVIEW_BASE = "/tools/diagrams/";
const skipPreview = process.env.E2E_SKIP_PREVIEW === "1";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./tests/.output/results",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  workers: CI ? 2 : undefined,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  // On CI each shard also writes a blob report; the workflow merges them into one HTML report.
  reporter: CI
    ? [
        ["github"],
        ["html", { outputFolder: "./tests/.output/report", open: "never" }],
        ["blob", { outputDir: "./tests/.output/blob" }],
      ]
    : [["list"], ["html", { outputFolder: "./tests/.output/report", open: "never" }]],
  use: {
    baseURL: `http://localhost:${DEV_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    testIdAttribute: "data-testid",
    viewport: { width: 1440, height: 900 },
    colorScheme: "light",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      testIgnore: /subpath\.spec\.ts/,
    },
    ...(skipPreview
      ? []
      : [
          {
            name: "subpath",
            use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${PREVIEW_PORT}${PREVIEW_BASE}` },
            testMatch: /subpath\.spec\.ts/,
          },
        ]),
  ],
  webServer: [
    {
      command: `pnpm dev --port ${DEV_PORT} --strictPort`,
      url: `http://localhost:${DEV_PORT}`,
      reuseExistingServer: dev.explicit || !CI,
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    ...(skipPreview
      ? []
      : [
          {
            // `vite build` directly (not `pnpm build`) so another lane's in-progress type errors don't
            // block the suite; tsc runs separately in `pnpm check`. Output goes to a scratch dir so
            // the real dist/ is untouched.
            command: `pnpm exec vite build --outDir tests/.output/preview-dist --emptyOutDir --logLevel error && pnpm exec vite preview --outDir tests/.output/preview-dist --port ${PREVIEW_PORT} --strictPort --base ${PREVIEW_BASE}`,
            url: `http://localhost:${PREVIEW_PORT}${PREVIEW_BASE}`,
            reuseExistingServer: preview.explicit || !CI,
            timeout: 180_000,
            stdout: "ignore" as const,
            stderr: "pipe" as const,
          },
        ]),
  ],
});
