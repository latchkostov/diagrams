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
  const base = rows([900, 100, 200]);
  const head = [...rows([450, 50, 100]), ...rows([1]).map((row) => ({ ...row, traced: true }))];
  const report = compareSurvey(base, head);
  equal(report.split("-50.0%").length - 1, 4);
  match(report, /200 \(100–900\)/);
  match(report, /100 \(50–450\)/);
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
    // Unordered and skewed: the median differs from the mean and the input's middle pair.
    [9, 1, 3, 2].map((n) => ({ metric, traced: false, data: { wall: (i + 1) * n * 100 * factor } })),
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
    "| Auto-layout | 500 | 250 (100–900) | 125 (50–450) | -50.0% | 4/4 |",
    "| Paste 50 | 500 | 500 (200–1800) | 500 (200–1800) | 0.0% | 4/4 |",
    "| Auto-layout | 1500 | 750 (300–2700) | 1125 (450–4050) | 50.0% | 4/4 |",
    "| Paste 50 | 1500 | 1000 (400–3600) | 2000 (800–7200) | 100.0% | 4/4 |",
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
