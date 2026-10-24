import { expect, it } from "vitest";
import { createCoverageMap } from "@vitest/istanbul-lib-coverage";
import { mergeCoverage } from "../../scripts/ci/merge-coverage.mjs";

const start = { line: 1, column: 0 };
const short = { start, end: { line: 1, column: 5 } };
const long = { start, end: { line: 2, column: 7 } };
const file = "/src/collision.ts";
const part = (left: number[], right: number[]) => ({
  [file]: {
    path: file,
    statementMap: { 0: short },
    fnMap: { 0: { name: "render", decl: short, loc: long, line: 1 } },
    branchMap: {
      0: { type: "binary-expr", loc: long, locations: [short, long], line: 1 },
      1: { type: "cond-expr", loc: short, locations: [short, short], line: 1 },
    },
    s: { 0: 1 },
    f: { 0: 1 },
    b: { 0: left, 1: right },
  },
});

it("keeps distinct remapped branches sharing a start location and unions every arm's hits", () => {
  const a = part([2, 0], [0, 1]),
    b = part([0, 3], [4, 0]);
  const original = structuredClone(a);
  const merged = mergeCoverage([a, b]);
  expect(createCoverageMap(merged).getCoverageSummary().branches).toEqual({
    total: 4,
    covered: 4,
    skipped: 0,
    pct: 100,
  });
  expect(Object.values(merged[file].b)).toEqual(
    expect.arrayContaining([
      [2, 3],
      [4, 1],
    ]),
  );
  expect(mergeCoverage([b, a])).toEqual(merged);
  expect(a).toEqual(original);
});

it("preserves multiple source counters whose entire remapped locations are indistinguishable", () => {
  const a = part([1, 0], [0, 1]),
    b = part([0, 1], [1, 0]);
  a[file].branchMap[1] = { ...a[file].branchMap[0] };
  b[file].branchMap[1] = { ...b[file].branchMap[0] };
  const merged = mergeCoverage([a, b]);
  expect(createCoverageMap(merged).getCoverageSummary().branches.total).toBe(4);
  expect(Object.values(merged[file].b)).toEqual([
    [1, 1],
    [1, 1],
  ]);
});

it("rejects malformed counters instead of producing an apparently complete summary", () => {
  const broken = part([1, 0], [0, -1]);
  expect(() => mergeCoverage([broken])).toThrow("Invalid coverage counter");
  expect(() => mergeCoverage([part([1], [0, 1])])).toThrow("Invalid coverage counter");
  expect(() => mergeCoverage([part([Number.MAX_SAFE_INTEGER, 0], [0, 1]), part([1, 0], [0, 1])])).toThrow(
    "Invalid coverage counter",
  );
});

it("keeps duplicate-counter ordinals stable when already-merged parts are merged again", () => {
  const multiple = (hit: boolean) => ({
    [file]: {
      ...part([0, 0], [0, 0])[file],
      branchMap: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i, part([0, 0], [0, 0])[file].branchMap[0]])),
      b: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i, [hit && i === 2 ? 1 : 0, 0]])),
    },
  });
  const hit = multiple(true),
    zero = multiple(false);
  const together = mergeCoverage([hit, zero, hit]);
  expect(mergeCoverage([mergeCoverage([hit, zero]), hit])).toEqual(together);
  expect(createCoverageMap(together).getCoverageSummary().branches.covered).toBe(1);
});
