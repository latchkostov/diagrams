import { test } from "node:test";
import { equal, match, throws } from "node:assert/strict";
import { compareSurvey } from "./survey2-compare.mjs";

const rows = (values) =>
  [500, 1500].flatMap((size) =>
    ["layout", "paste50"].flatMap((metric) =>
      values.map((wall) => ({
        metric: `${metric}-${size}`,
        traced: false,
        data: { wall },
      })),
    ),
  );
test("compares complete groups and excludes diagnostic traces", () => {
  const base = rows([100, 200, 300]);
  const head = [...rows([50, 100, 150]), ...rows([1]).map((row) => ({ ...row, traced: true }))];
  const report = compareSurvey(base, head);
  equal(report.split("-50.0%").length - 1, 4);
  match(report, /200 \(100–300\)/);
  match(report, /100 \(50–150\)/);
  match(report, /3\/3/);
});
test("refuses absent, undersampled and invalid groups", () => {
  throws(() => compareSurvey(rows([1, 2]), rows([1, 2, 3])), /at least three/);
  throws(() => compareSurvey(rows([1, NaN, 3]), rows([1, 2, 3])), /finite positive/);
  throws(() => compareSurvey(rows([1, 2, 3]), []), /at least three/);
});

const groups = ["layout-500", "paste50-500", "layout-1500", "paste50-1500"];
const distinct = (factor = 1) =>
  groups.flatMap((metric, i) =>
    [1, 2, 3, 4].map((n) => ({ metric, traced: false, data: { wall: (i + 1) * n * 100 * factor } })),
  );

test("isolates each action and size, including even medians and unrelated metrics", () => {
  const base = distinct();
  const head = distinct().map((row) => ({
    ...row,
    data: { wall: (row.data.wall * (groups.indexOf(row.metric) + 1)) / 2 },
  }));
  const report = compareSurvey(
    [...base, { metric: "unrelated-500", data: { wall: NaN } }],
    [...head, ...distinct(1000).map((row) => ({ ...row, traced: true }))],
  );
  for (const line of [
    "| Auto-layout | 500 | 250 (100–400) | 125 (50–200) | -50.0% | 4/4 |",
    "| Paste 50 | 500 | 500 (200–800) | 500 (200–800) | 0.0% | 4/4 |",
    "| Auto-layout | 1500 | 750 (300–1200) | 1125 (450–1800) | 50.0% | 4/4 |",
    "| Paste 50 | 1500 | 1000 (400–1600) | 2000 (800–3200) | 100.0% | 4/4 |",
  ])
    equal(report.includes(line), true, line);
});

for (const metric of groups)
  for (const side of ["base", "head"])
    for (const fault of ["missing", "undersampled", "invalid"])
      test(`refuses only ${side} ${metric} being ${fault}`, () => {
        const good = distinct();
        const broken = good.filter((row) => row.metric !== metric);
        if (fault !== "missing") {
          broken.push(...[1, fault === "invalid" ? 0 : 2].map((wall) => ({ metric, traced: false, data: { wall } })));
          if (fault === "invalid") broken.push({ metric, traced: false, data: { wall: 3 } });
        }
        // Traced observations must not fill holes in an unprofiled group.
        broken.push(...good.filter((row) => row.metric === metric).map((row) => ({ ...row, traced: true })));
        throws(() => compareSurvey(...(side === "base" ? [broken, good] : [good, broken])), new RegExp(metric));
      });
