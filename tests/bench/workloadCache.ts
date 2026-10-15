// Where materialised workloads live (docs/BENCHMARKS.md § Workloads). The Node benchmarks write each workload's JSON
// the first time they need it; the browser benchmarks read the same files (Playwright can't run the importers, which
// need Vite's transforms). The directory is keyed by a hash of everything that shapes a workload: the generators,
// the public examples (the tiled family) and the importers (the imported families), so a changed generator never
// reads a stale copy.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { outDir } from "./results";

const INPUTS = [
  "src/bench/workloads",
  "src/interop/infra",
  "src/interop/native.ts",
  "src/model",
  "src/lab/generators.ts",
];

function files(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path)
    .filter((f) => !f.endsWith(".test.ts"))
    .flatMap((f) => files(join(path, f)));
}

let key: string | undefined;

/** A short hash of the workload generators' inputs. */
export function workloadKey(root = process.cwd()): string {
  if (key) return key;
  const h = createHash("sha256");
  const examples = readdirSync(join(root, "src", "examples"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => join(root, "src", "examples", f));
  const all = [...INPUTS.flatMap((p) => files(join(root, p))), ...examples].sort();
  for (const f of all) h.update(relative(root, f).replaceAll("\\", "/")).update(readFileSync(f));
  key = h.digest("hex").slice(0, 12);
  return key;
}

/** The JSON file of a materialised workload. */
export const workloadFile = (family: string, n: number) =>
  join(outDir(), "workloads", workloadKey(), `${family}-${n}.json`);
