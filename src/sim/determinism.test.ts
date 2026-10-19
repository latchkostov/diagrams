import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { POWERS } from "./latencyBounds";
import { latencyBucket } from "./latency";
import { ENGINE_SOURCES } from "../../scripts/engine-version";

// What keeps a simulation bit-identical in every JS engine (shared Live; docs/PARITY.md, "Across engines"): basic
// IEEE arithmetic and Math.sqrt are exactly rounded everywhere, but Math.exp, Math.log, Math.pow and the other
// transcendental functions aren't specified to the bit, and WebKit's Math.log did put latencies in other buckets
// than V8's. So the simulator never calls them; tests/engines (Nightly) checks the runs themselves.

const TRANSCENDENTAL =
  /Math\.(exp|expm1|log|log10|log2|log1p|pow|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|cbrt|hypot)\b|[\w)\]]\s*\*\*\s*[\w(.]/;

/** Files that never run in a simulation: colour maths for drawing. */
const NOT_SIMULATION = new Set(["src/model/colors.ts"]);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(join(dir, entry.name))
      : /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)
        ? [join(dir, entry.name).replaceAll("\\", "/")]
        : [],
  );
}

describe("the simulator is bit-identical across JS engines", () => {
  it("calls no transcendental Math function, and no ** (the engine, the model and the stencil data it reads)", () => {
    const found: string[] = [];
    // The same code the engine version hashes (scripts/engine-version.ts).
    for (const file of ENGINE_SOURCES.flatMap(sources)) {
      if (NOT_SIMULATION.has(file)) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          const code = line
            .replace(/\/\*.*?\*\//g, "")
            .replace(/\/\/.*$/, "")
            .replace(/^\s*\/?\*.*$/, "");
          if (TRANSCENDENTAL.test(code)) found.push(`${file}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(found).toEqual([]);
  });

  it("the latency bounds are the powers of 1.12 they stand for", () => {
    expect(POWERS).toHaveLength(127);
    for (let k = 0; k < POWERS.length; k++) {
      // Exactly V8's (the goldens' latency percentiles print these bounds).
      expect(POWERS[k]).toBe(1.12 ** k);
      if (k) expect(POWERS[k]).toBeGreaterThan(POWERS[k - 1]);
    }
  });

  it("a latency lands in the bucket Math.log put it in, for every latency short of an exact bound", () => {
    // The old formula, V8's: kept here as the reference it replaced.
    const old = (l: number) => (l <= 0 ? 0 : Math.min(127, Math.max(1, Math.ceil(Math.log(l) / Math.log(1.12)) + 1)));
    for (let ms = 0; ms <= 200_000; ms++) expect(latencyBucket(ms)).toBe(old(ms));
    for (let ms = 0; ms <= 20_000; ms++) expect(latencyBucket(ms / 8)).toBe(old(ms / 8));
    // At exactly a bound, the comparison is exact where Math.log rounded up.
    for (let k = 0; k < POWERS.length; k++) expect(latencyBucket(POWERS[k])).toBe(Math.min(127, k + 1));
    expect(latencyBucket(10 ** 9)).toBe(127);
  });
});
