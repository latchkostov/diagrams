import { spawnSync } from "node:child_process";
import process from "node:process";

// Native regex work is invisible to JavaScript probes. Preserve the original adversarial timing guards
// in the Benchmarks workflow, outside coverage and the parallel unit lane.
const run = spawnSync(
  process.execPath,
  [
    "node_modules/vitest/vitest.mjs",
    "run",
    "--project",
    "unit",
    "--maxWorkers",
    "1",
    "src/interop/infra/hostile.test.ts",
    "src/interop/infra/kubernetes.test.ts",
    "src/interop/infra/terraform.test.ts",
    "src/ai/ondevice/requestEdits.test.ts",
    "src/ai/ondevice/compactOps.test.ts",
    "src/sim/lineage.test.ts",
    "-t",
    "(runs every pattern|runs its own patterns|adversarial request|long adversarial input|measures checkpoint playback)",
  ],
  { stdio: "inherit", env: { ...process.env, COMPLEXITY_TIMING: "1" } },
);
process.exitCode = run.status ?? 1;
