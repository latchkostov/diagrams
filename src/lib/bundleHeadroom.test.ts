import { expect, it } from "vitest";
import { bundleBudget } from "../../scripts/bench/headroom.mjs";
import { summary } from "../../scripts/bench/report.mjs";
import { ESLint } from "eslint";

it("warns only below the fixed floor, fails only above budget, and preserves signed PR deltas", () => {
  expect(bundleBudget(10_000, 18_192, 11_000)).toEqual({ headroom: 8192, warning: false, base: 11_000, delta: -1000 });
  expect(bundleBudget(10_001, 18_192, 10_000)).toMatchObject({ warning: true, delta: 1 });
  expect(bundleBudget(18_192, 18_192)).toEqual({ headroom: 0, warning: true });
  expect(bundleBudget(18_193, 18_192)).toEqual({ headroom: -1, warning: false });
  const text = summary({
    meta: {
      date: "today",
      mode: "gates",
      cpuThrottle: 2,
      calibrationMs: {},
      env: { commit: "abc", branch: "feature" },
    },
    info: { "build-bundle": { mergeBase: "base-sha" } },
    metrics: [
      {
        id: "bundle/entry/gzip",
        suite: "bundle",
        scenario: "entry",
        unit: "bytes",
        value: 10_001,
        gate: { op: "<=", pass: true, limit: 18_192 },
        budget: bundleBudget(10_001, 18_192, 10_000),
      },
    ],
  });
  expect(text).toContain("base-sha");
  expect(text).toContain("| entry | 10000 | 10001 | +1 | 18192 | 8191 | Warning: schedule trim |");
  expect(text).toContain("Gates: 1 of 1 pass");
});

it("rejects static inspector feature imports in CanvasView while allowing type and lazy imports", async () => {
  const eslint = new ESLint();
  for (const name of ["SimulationFields", "EdgePanel"]) {
    const [result] = await eslint.lintText(`import { Feature } from "./inspector/${name}"; export { Feature };`, {
      filePath: "src/canvas/CanvasView.tsx",
    });
    expect(result.messages.some((m) => m.ruleId === "no-restricted-imports")).toBe(true);
  }
  const [result] = await eslint.lintText(
    'import type { Feature } from "./inspector/EdgePanel"; export type { Feature }; export const load = () => import("./inspector/EdgePanel");',
    { filePath: "src/canvas/CanvasView.tsx" },
  );
  expect(result.messages.filter((m) => m.ruleId === "no-restricted-imports")).toEqual([]);
});
