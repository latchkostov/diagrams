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
