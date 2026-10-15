// The Node benchmarks (docs/BENCHMARKS.md): `pnpm bench:node`, or `pnpm bench` for everything. The app's Vite config
// (its plugins: the i18n messages, example metadata) with a test section of its own: one file at a time in one forked
// process with --expose-gc (a GC before each sample), no type checking or coverage (`pnpm test` does those), and
// long timeouts (the biggest workloads take seconds per sample; nothing here is a budget in ms).

import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import app from "../../vite.config";

/**
 * Benchmarks never read src/examples/private (CLAUDE.md): fail on any module that would load from it. In tests
 * (development mode) src/examples/index.ts globs them eagerly, so a benchmark importing it fails here instead.
 */
function noPrivateData(): Plugin {
  const isPrivate = (id: string) => /[/\\]examples[/\\]private[/\\]/.test(id);
  return {
    name: "bench-no-private-data",
    enforce: "pre",
    resolveId(source, importer) {
      if (isPrivate(source) || (importer && isPrivate(importer)))
        throw new Error(`Benchmarks never read src/examples/private (imported ${source} from ${importer ?? "?"})`);
      return null;
    },
    load(id) {
      if (isPrivate(id)) throw new Error(`Benchmarks never read src/examples/private (${id})`);
      return null;
    },
  };
}

const root = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  ...app,
  root,
  plugins: [noPrivateData(), ...(app.plugins ?? [])],
  test: {
    root,
    include: ["tests/bench/node/**/*.bench.ts"],
    environment: "node",
    pool: "forks",
    fileParallelism: false,
    maxWorkers: 1,
    execArgv: ["--expose-gc"],
    testTimeout: 900_000,
    hookTimeout: 120_000,
    typecheck: { enabled: false },
    css: { include: [/tokens\.css/] },
    reporters: process.env.CI ? ["default", "github-actions"] : ["default"],
  },
});
