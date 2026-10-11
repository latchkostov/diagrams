import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config. Three projects:
 *  - "chromium": every spec in tests/e2e except subpath.spec.ts and tests tagged @dev, against the app
 *                server on E2E_PORT (default 5191). What that server is depends on E2E_TARGET:
 *                  build (default on CI): `vite preview` of a production build made with VITE_E2E=1, which
 *                         keeps the dev-only test hooks (`?storage=test`, the Lab tab) and nothing else.
 *                  dev   (default locally): the Vite dev server.
 *  - "dev":      tests that need the Vite dev server (DEV_ONLY below: React's development-only internals,
 *                or source modules imported in the page). With E2E_TARGET=dev it is the same server as "chromium";
 *                with E2E_TARGET=build it runs on E2E_DEV_PORT (default E2E_PORT + 1).
 *  - "subpath":  tests/e2e/subpath.spec.ts against a real production build (no test hooks) served by
 *                `vite preview` under /tools/diagrams/ (port E2E_PREVIEW_PORT, default 5193).
 *
 * Ports: set E2E_PORT / E2E_DEV_PORT / E2E_PREVIEW_PORT to run beside another checkout's servers. A running
 * server is reused only when its port was chosen explicitly, or locally (not on CI) on the default port, so
 * a CI run never silently tests a server it didn't start.
 * E2E_PREBUILT=1 serves tests/.output/e2e-dist and tests/.output/preview-dist as they are (CI builds them
 * in an earlier step); otherwise each run builds what it serves.
 * Skip the production-build server locally with E2E_SKIP_PREVIEW=1 (saves a build per run).
 * Every test gets a fresh browser context, so localStorage (settings, autosave) starts empty.
 * All outputs live in tests/.output (gitignored by tests/.gitignore).
 */
const CI = !!process.env.CI;

/** A port from the environment, or the default; `explicit` says whether the caller chose it. */
function port(name: string, fallback: number, explicitFallback = false): { port: number; explicit: boolean } {
  const raw = process.env[name];
  if (!raw) return { port: fallback, explicit: explicitFallback };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`${name} must be a port number, got "${raw}"`);
  return { port: n, explicit: true };
}

const TARGET = process.env.E2E_TARGET ?? (CI ? "build" : "dev");
if (TARGET !== "build" && TARGET !== "dev") throw new Error(`E2E_TARGET must be "build" or "dev", got "${TARGET}"`);
const BUILD = TARGET === "build";

const app = port("E2E_PORT", 5191);
const devServer = BUILD ? port("E2E_DEV_PORT", app.port + 1, app.explicit) : app;
const preview = port("E2E_PREVIEW_PORT", 5193);
export const PREVIEW_BASE = "/tools/diagrams/";
const skipPreview = process.env.E2E_SKIP_PREVIEW === "1";
const prebuilt = process.env.E2E_PREBUILT === "1";

/**
 * Tests that need the dev server: they read React's development-only fiber timings and component names,
 * or import source modules in the page (`import("/src/...")`). Tag a test with `@dev` in its title or
 * `{ tag: "@dev" }`; a spec file listed here runs on the dev server whole. (`grep` matches the project
 * name, file path, titles and tags.)
 */
const DEV_ONLY = /@dev|library-regressions\.spec\.ts|ai-privacy\.spec\.ts/;

/**
 * `vite build` directly (not `pnpm build`) so another lane's in-progress type errors don't block the suite;
 * tsc runs separately in `pnpm check`. Output goes to a scratch dir so the real dist/ is untouched.
 */
const viteBuild = (outDir: string) => `pnpm exec vite build --outDir ${outDir} --emptyOutDir --logLevel error`;
const serve = (outDir: string, extra: string) =>
  `${prebuilt ? "" : `${viteBuild(outDir)} && `}pnpm exec vite preview --outDir ${outDir} ${extra}`;

const E2E_DIST = "tests/.output/e2e-dist";
const PREVIEW_DIST = "tests/.output/preview-dist";

const devWebServer = {
  command: `pnpm dev --port ${devServer.port} --strictPort`,
  url: `http://localhost:${devServer.port}`,
  reuseExistingServer: devServer.explicit || !CI,
  timeout: 60_000,
  stdout: "ignore" as const,
  stderr: "pipe" as const,
};

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./tests/.output/results",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  // GitHub's Linux runners have 4 vCPUs: three browsers plus the preview server.
  workers: CI ? 3 : undefined,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  // On CI each shard also writes a blob report (the workflow merges them into one HTML report) and a JSON
  // report (per-test durations, uploaded as an artifact and summarised on the run page).
  reporter: CI
    ? [
        ["github"],
        ["html", { outputFolder: "./tests/.output/report", open: "never" }],
        ["blob", { outputDir: "./tests/.output/blob" }],
        ["json", { outputFile: "./tests/.output/results.json" }],
      ]
    : [["list"], ["html", { outputFolder: "./tests/.output/report", open: "never" }]],
  use: {
    baseURL: `http://localhost:${app.port}`,
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
      grepInvert: DEV_ONLY,
    },
    {
      name: "dev",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        baseURL: `http://localhost:${devServer.port}`,
      },
      testIgnore: /subpath\.spec\.ts/,
      grep: DEV_ONLY,
    },
    ...(skipPreview
      ? []
      : [
          {
            name: "subpath",
            use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${preview.port}${PREVIEW_BASE}` },
            testMatch: /subpath\.spec\.ts/,
          },
        ]),
  ],
  webServer: [
    devWebServer,
    ...(BUILD
      ? [
          {
            // The e2e build: production React and bundling, plus the test hooks (VITE_E2E=1).
            command: serve(E2E_DIST, `--port ${app.port} --strictPort`),
            url: `http://localhost:${app.port}`,
            env: { VITE_E2E: "1" },
            reuseExistingServer: app.explicit || !CI,
            timeout: 180_000,
            stdout: "ignore" as const,
            stderr: "pipe" as const,
          },
        ]
      : []),
    ...(skipPreview
      ? []
      : [
          {
            // The production build, exactly as it ships (no VITE_E2E).
            command: serve(PREVIEW_DIST, `--port ${preview.port} --strictPort --base ${PREVIEW_BASE}`),
            url: `http://localhost:${preview.port}${PREVIEW_BASE}`,
            env: { VITE_E2E: "" },
            reuseExistingServer: preview.explicit || !CI,
            timeout: 180_000,
            stdout: "ignore" as const,
            stderr: "pipe" as const,
          },
        ]),
  ],
});
