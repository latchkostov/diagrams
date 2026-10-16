// Builds what the browser benchmarks serve (docs/BENCHMARKS.md § Method):
//
//   node scripts/bench/build.mjs [outDir]       (default tests/.output/bench)
//
// - <outDir>/dist: the e2e build (VITE_E2E=1), exactly what `E2E_TARGET=build` tests: production React and bundling,
//   plus the test hooks (`window.__checks`, `__planning`, `__simulations`, the `?storage=test` provider). Timings run
//   on it.
// - <outDir>/dist-names: the same build with `output.keepNames`, so component functions keep their names in production
//   React. Only render counts run on it (they name the components that rendered); its code is the same, its function
//   names aren't minified away.
// Neither is the shipped build: `pnpm bench` measures the shipped bundle's composition separately (bundle.mjs).

import { build } from "vite";
import path from "node:path";
import process from "node:process";
import console from "node:console";

const out = path.resolve(process.argv[2] ?? path.join("tests", ".output", "bench"));
const configFile = path.resolve("vite.config.ts");

async function make(dir, extra = {}) {
  const started = Date.now();
  await build({
    configFile,
    logLevel: "error",
    ...extra,
    build: { outDir: dir, emptyOutDir: true, ...extra.build },
  });
  console.log(`bench build: ${path.relative(process.cwd(), dir)} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

// The config reads VITE_E2E when it loads, and NODE_ENV decides production React.
process.env.VITE_E2E = "1";
process.env.NODE_ENV = "production";
await make(path.join(out, "dist"));
await make(path.join(out, "dist-names"), {
  build: { rolldownOptions: { output: { keepNames: true } } },
});
