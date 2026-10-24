import { expect, it } from "vitest";
import { compareCoverage } from "../../scripts/ci/compare-coverage.mjs";

const metric = { total: 10, covered: 8, skipped: 0, pct: 80 };
const file = { statements: metric, branches: metric, functions: metric, lines: metric };
const reference = { total: file, "C:/repo/src/example.ts": file };

it("compares all four coverage metrics and file identities across runner roots", () => {
  expect(compareCoverage({ total: file, "/work/src/example.ts": file }, reference)).toEqual([]);
  expect(compareCoverage({ total: file }, reference)).not.toEqual([]);
  expect(compareCoverage({ ...reference, total: { ...file, branches: { ...metric, covered: 7 } } }, reference)).toEqual(
    ["total branches.covered: 7 != 8"],
  );
  expect(
    compareCoverage(
      { ...reference, "C:/repo/src/example.ts": { ...file, functions: { ...metric, total: 11 } } },
      reference,
    ),
  ).toEqual(["src/example.ts functions.total: 11 != 10"]);
});
