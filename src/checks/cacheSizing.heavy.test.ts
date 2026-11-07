import { expect, it, vi } from "vitest";
import type { DiagramFile } from "../model/types";
import blackFriday from "../examples/black-friday-commerce.json";
import { buildContext } from "./context";
import { runChecks } from "./run";
import { planScaling, PLANNER_LIMITS } from "../sim/scalingPlanner";
import { registerRequestChecks } from "../lib/requestCheckCache";
import * as caching from "./cacheFindings";

it("Black Friday cache Checks do not add scenario-sizing calls or change their results", () => {
  const d = blackFriday as DiagramFile;
  const measure = () => {
    registerRequestChecks(undefined);
    const context = buildContext(d);
    context.local = true;
    let calls = 0,
      sizingMs = 0;
    const counter = { ticks: 0, runs: 0, messages: 0 };
    let plans: ReturnType<typeof planScaling> | undefined;
    context.plans = () => {
      if (!plans) {
        const started = performance.now();
        // An explicit unchanged message budget bypasses the planner memo on both sides.
        plans = planScaling(d, counter, { remaining: PLANNER_LIMITS.messages });
        sizingMs += performance.now() - started;
        calls++;
      }
      return plans;
    };
    const started = performance.now();
    const result = runChecks(d, { context });
    return { calls, plans, counter, result, sizingMs, totalMs: performance.now() - started };
  };
  const withoutCache = vi.spyOn(caching, "computeCacheFindings").mockReturnValue([]);
  let before: ReturnType<typeof measure>;
  try {
    before = measure();
  } finally {
    withoutCache.mockRestore();
  }
  const after = measure();
  expect(before.calls).toBe(1);
  expect(after.calls).toBe(before.calls);
  expect(after.plans).toEqual(before.plans);
  expect(after.counter).toEqual(before.counter);
  expect(after.result.findings).toEqual([]);
  if (process.env.CDN6_MEASURE)
    console.log(
      JSON.stringify({
        before: { checksMs: before.totalMs, sizingMs: before.sizingMs },
        after: { checksMs: after.totalMs, sizingMs: after.sizingMs },
        sizingWork: after.counter,
      }),
    );
});
