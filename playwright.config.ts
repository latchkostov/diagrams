import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config. Five projects:
 *  - "chromium": every spec in tests/e2e except those with a build of their own (below) and tests tagged @dev, against the app
 *                server on E2E_PORT (default 5191). What that server is depends on E2E_TARGET:
 *                  build (default on CI): `vite preview` of a production build made with VITE_E2E=1, which
 *                         keeps the dev-only test hooks (`?storage=test`, the Lab tab) and nothing else.
 *                  dev   (default locally): the Vite dev server.
 *  - "dev":      tests that need the Vite dev server (DEV_ONLY below: React's development-only internals,
 *                or source modules imported in the page). With E2E_TARGET=dev it is the same server as "chromium";
 *                with E2E_TARGET=build it runs on E2E_DEV_PORT (default E2E_PORT + 1).
 *  - "subpath":  tests/e2e/subpath.spec.ts against a real production build (no test hooks) served by
 *                `vite preview` under /tools/diagrams/ (port E2E_PREVIEW_PORT, default 5193).
 *  - "internal": tests/e2e/self-host.spec.ts against a self-hosting build (docs/SELF-HOSTING.md): production with
 *                `pnpm build:internal`'s switches and a brand name (port E2E_INTERNAL_PORT, default preview + 1).
 *  - "locked":   tests/e2e/self-host-locked.spec.ts against one with every switch off, opening links included
 *                (port E2E_LOCKED_PORT, default preview + 2).
 *
 * Ports: set E2E_PORT / E2E_DEV_PORT / E2E_PREVIEW_PORT to run beside another checkout's servers. A running
 * server is reused only when its port was chosen explicitly, or locally (not on CI) on the default port, so
 * a CI run never silently tests a server it didn't start.
 * E2E_PREBUILT=1 serves tests/.output/{e2e,preview,internal,locked}-dist as they are (CI builds them in an earlier
 * step, .github/actions/e2e, with the envs below); otherwise each run builds what it serves.
 * Skip the production-build servers (subpath, internal, locked) locally with E2E_SKIP_PREVIEW=1 (saves the builds);
 * E2E_SELF_HOST picks the self-hosting ones ("internal", "locked", both by default, "" for none). Those two are
 * served with a self-hosted copy's headers (PREVIEW_HEADERS=self-host), not the public site's.
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
const internal = port("E2E_INTERNAL_PORT", preview.port + 1, preview.explicit);
const locked = port("E2E_LOCKED_PORT", preview.port + 2, preview.explicit);
/** The self-hosting builds' switches (scripts/deployment-env.ts); .github/actions/e2e builds them the same way. */
export const INTERNAL_ENV = {
  VITE_DISABLE_SHARE_LINKS: "1",
  VITE_DISABLE_AI_TOOLS: "1",
  VITE_PRIVATE_BY_DEFAULT: "1",
  VITE_BRAND_NAME: "Acme Diagrams (internal)",
};
export const LOCKED_ENV = {
  VITE_DISABLE_SHARE_LINKS: "1",
  VITE_DISABLE_LINK_OPEN: "1",
  VITE_DISABLE_AI_TOOLS: "1",
  VITE_DISABLE_ONDEVICE: "1",
  VITE_PRIVATE_BY_DEFAULT: "1",
};
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
/**
 * Every server listens on IPv4 loopback, and the browser resolves `localhost` there. Left to themselves, Vite binds
 * `localhost` to one address (`[::1]` on some machines) while Chrome's connections to `localhost` can go to the
 * other: now and then a request was refused (net::ERR_CONNECTION_REFUSED) from a server that was up. Pages keep
 * `localhost` as their origin, so the self-hosting host pages on 127.0.0.1 stay another origin.
 */
const LOOPBACK = "127.0.0.1";
const viteBuild = (outDir: string) => `pnpm exec vite build --outDir ${outDir} --emptyOutDir --logLevel error`;
const serve = (outDir: string, extra: string) =>
  `${prebuilt ? "" : `${viteBuild(outDir)} && `}pnpm exec vite preview --outDir ${outDir} --host ${LOOPBACK} ${extra}`;

const E2E_DIST = "tests/.output/e2e-dist";
const PREVIEW_DIST = "tests/.output/preview-dist";
const INTERNAL_DIST = "tests/.output/internal-dist";
const LOCKED_DIST = "tests/.output/locked-dist";
/**
 * The self-hosting builds this run serves: E2E_SELF_HOST lists them ("internal,locked", the default; "" for none).
 * CI serves (and builds) only those its shard's spec files need.
 */
const SELF_HOST_WANTED = (process.env.E2E_SELF_HOST ?? "internal,locked").split(",").map((v) => v.trim());
const selfHost = [
  { name: "internal", spec: /self-host\.spec\.ts/, at: internal, dist: INTERNAL_DIST, env: INTERNAL_ENV },
  { name: "locked", spec: /self-host-locked\.spec\.ts/, at: locked, dist: LOCKED_DIST, env: LOCKED_ENV },
].filter((v) => SELF_HOST_WANTED.includes(v.name));
/** Specs with a build of their own (their projects below); the app's projects skip them. */
const OWN_BUILD = /(subpath|self-host|self-host-locked)\.spec\.ts/;

const devWebServer = {
  command: `pnpm dev --port ${devServer.port} --strictPort --host ${LOOPBACK}`,
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
    launchOptions: { args: [`--host-resolver-rules=MAP localhost ${LOOPBACK}`] },
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
      testIgnore: OWN_BUILD,
      grepInvert: DEV_ONLY,
    },
    {
      name: "dev",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        baseURL: `http://localhost:${devServer.port}`,
      },
      testIgnore: OWN_BUILD,
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
          ...selfHost.map(({ name, at, spec }) => ({
            name,
            use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${at.port}/` },
            testMatch: spec,
          })),
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
          // The self-hosting builds: production as it ships (no VITE_E2E), with the switches set.
          // Served with a self-hosted copy's headers (scripts/self-host-headers.ts), not the public site's.
          ...selfHost.map(({ dist, at, env }) => ({
            command: serve(dist, `--port ${at.port} --strictPort`),
            url: `http://localhost:${at.port}/`,
            // Embeds framed by the host pages tests/e2e/self-host-helpers.ts serves on 127.0.0.1.
            env: { VITE_E2E: "", PREVIEW_HEADERS: "self-host", PREVIEW_FRAME_ANCESTORS: "http://127.0.0.1:*", ...env },
            reuseExistingServer: at.explicit || !CI,
            timeout: 180_000,
            stdout: "ignore" as const,
            stderr: "pipe" as const,
          })),
        ]),
  ],
});
