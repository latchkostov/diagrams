// Measurement-only extension: also serve the shipped build for cold startup.
import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testMatch: /survey2\.bench\.ts$/,
  webServer: [
    ...(Array.isArray(base.webServer) ? base.webServer : []),
    {
      command: `pnpm exec vite preview --outDir "${resolve("dist")}" --host 127.0.0.1 --port ${Number(process.env.BENCH_PORT ?? 6210) + 2} --strictPort`,
      cwd: resolve("."),
      url: `http://localhost:${Number(process.env.BENCH_PORT ?? 6210) + 2}/`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
