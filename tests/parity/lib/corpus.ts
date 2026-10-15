// The harness's inputs. Public examples are read from src/examples (top level only: src/examples/private is
// never listed, opened or read). The frozen corpus (tests/parity/corpus) holds diagrams the harness owns, so a
// Lab or test fixture can change without moving a golden.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DiagramFile } from "../../../src/model/types";
import { ROOT } from "./golden";

export interface Named {
  slug: string;
  diagram: DiagramFile;
}

function readDir(dir: string, suffix: string): Named[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
    .map((entry) => entry.name)
    .sort()
    .map((name) => ({
      slug: name.slice(0, -suffix.length),
      diagram: JSON.parse(readFileSync(join(ROOT, dir, name), "utf8")) as DiagramFile,
    }));
}

/** The public examples, by slug, in file-name order. */
export const examples: Named[] = readDir("src/examples", ".json");

/** The harness's own diagrams (tests/parity/corpus/*.diagram.json). */
export const corpus: Named[] = readDir("tests/parity/corpus", ".diagram.json");

/**
 * Corpus diagrams only planning and checks read: 513 copies of one connection, which exist to cross the planning
 * work budget (src/planning/budget.ts). Everywhere else they would only repeat one route 513 times, and in playback
 * one message fans out to more events in one tick than the engine's log keeps.
 */
const BUDGET_ONLY = new Set(["planning-analysis-limit"]);
const prefixed = (c: Named): Named => ({ ...c, slug: `corpus-${c.slug}` });

/** Every diagram the per-diagram goldens cover: examples first, then the corpus (prefixed "corpus-"). */
export const allDiagrams: Named[] = [...examples, ...corpus.filter((c) => !BUDGET_ONLY.has(c.slug)).map(prefixed)];

/** allDiagrams and the budget-only ones: for planning and checks. */
export const planningDiagrams: Named[] = [...examples, ...corpus.map(prefixed)];

/** Reads a fixture file under the repository root. */
export function fixture(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

/** Every `n`th item starting at `k` (0-based), to split one long list over several test files (workers). */
export function shard<T>(items: readonly T[], k: number, n: number): T[] {
  return items.filter((_, i) => i % n === k);
}
