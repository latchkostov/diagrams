import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

/**
 * The browser benchmarks (docs/BENCHMARKS.md): `pnpm bench:ui`, or `pnpm bench` for everything. One worker, no retries,
 * no parallelism: a benchmark shares the machine with nothing of its own. Two servers, both `vite preview` of builds
 * made by scripts/bench/build.mjs (`pnpm bench` builds them first):
 *  - BENCH_PORT (default 6210): the e2e build (VITE_E2E=1, production React and bundling, the test hooks). Timings.
 *  - BENCH_PORT + 1: the same build with function names kept. Render counts only.
 * Ports 6210–6219 are the benchmarks'. A server already listening on them is reused only when BENCH_REUSE=1.
 */
const PORT = Number(process.env.BENCH_PORT ?? 6210);
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = resolve(ROOT, process.env.BENCH_OUT ?? "tests/.output/bench");
const LOOPBACK = "127.0.0.1";
const preview = (dir: string, port: number) => ({
  command: `pnpm exec vite preview --outDir "${resolve(OUT, dir)}" --host ${LOOPBACK} --port ${port} --strictPort`,
  cwd: ROOT,
  url: `http://localhost:${port}/`,
  reuseExistingServer: process.env.BENCH_REUSE === "1",
  timeout: 60_000,
  stdout: "ignore" as const,
  stderr: "pipe" as const,
});

export default defineConfig({
  testDir: "./ui",
  testMatch: /.*\.bench\.ts$/,
  outputDir: resolve(OUT, "ui-results"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  // The biggest workloads load in tens of seconds at the CPU throttle; nothing here is a budget in ms.
  timeout: 15 * 60_000,
  expect: { timeout: 60_000 },
  reporter: [["list"], ["json", { outputFile: resolve(OUT, "ui-report.json") }]],
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: "light",
    locale: "en-US",
    timezoneId: "UTC",
    testIdAttribute: "data-testid",
    baseURL: `http://localhost:${PORT}/`,
    actionTimeout: 60_000,
    navigationTimeout: 120_000,
    trace: "off",
    video: "off",
    screenshot: "off",
    launchOptions: {
      args: [
        `--host-resolver-rules=MAP localhost ${LOOPBACK}`,
        // A benchmark tab must not be throttled for being in the background or idle.
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
      ],
    },
  },
  webServer: [preview("dist", PORT), preview("dist-names", PORT + 1)],
});
