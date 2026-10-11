import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config. Two projects:
 *  - "chromium": every spec in tests/e2e against the Vite dev server (port 5191).
 *  - "subpath":  tests/e2e/subpath.spec.ts against a production build served by `vite preview`
 *                under /tools/diagrams/ (port 5193), proving the build embeds under a sub-path.
 *
 * Skip the production-build server locally with E2E_SKIP_PREVIEW=1 (saves a build per run).
 * Every test gets a fresh browser context, so localStorage (settings, autosave) starts empty.
 * All outputs live in tests/.output (gitignored by tests/.gitignore).
 */
const CI = !!process.env.CI;
const DEV_PORT = 5191;
const PREVIEW_PORT = 5193;
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
  reporter: CI
    ? [["github"], ["html", { outputFolder: "./tests/.output/report", open: "never" }]]
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
      reuseExistingServer: !CI,
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
            reuseExistingServer: !CI,
            timeout: 180_000,
            stdout: "ignore" as const,
            stderr: "pipe" as const,
          },
        ]),
  ],
});
