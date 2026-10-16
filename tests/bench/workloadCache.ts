// Where materialised workloads live (docs/BENCHMARKS.md § Workloads). The Node benchmarks write each workload's JSON
// the first time they need it; the browser benchmarks read the same files (Playwright can't run the importers, which
// need Vite's transforms). The directory is keyed by a hash of every source the generators can reach (all of src/
// but tests, the public examples included) and the lockfile, so a changed generator, importer, layout or library never
// reads a stale copy. src/examples/private is never read.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { outDir } from "./results";

const INPUTS = ["src", "pnpm-lock.yaml"];
/** Never read: the owner's local-only diagrams (CLAUDE.md). */
const PRIVATE = /[/\\]examples[/\\]private$/;

function files(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  if (PRIVATE.test(path)) return [];
  return readdirSync(path)
    .filter((f) => !/\.test\.tsx?$/.test(f))
    .flatMap((f) => files(join(path, f)));
}

let key: string | undefined;

/** A short hash of the workload generators' inputs. */
export function workloadKey(root = process.cwd()): string {
  if (key) return key;
  const h = createHash("sha256");
  const all = INPUTS.flatMap((p) => files(join(root, p))).sort();
  for (const f of all) h.update(relative(root, f).replaceAll("\\", "/")).update(readFileSync(f));
  key = h.digest("hex").slice(0, 12);
  return key;
}

/** The JSON file of a materialised workload. */
export const workloadFile = (family: string, n: number) =>
  join(outDir(), "workloads", workloadKey(), `${family}-${n}.json`);
