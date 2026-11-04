import { expect, it } from "vitest";
import example from "../examples/black-friday-commerce.json";
import type { DiagramFile } from "../model/types";
import { planScaling } from "./scalingPlanner";

const d = example as DiagramFile;
const previous = { ...d, simulations: d.simulations!.filter((s) => s.id !== "edge-deploy") };
function measure(input: DiagramFile) {
  const counter = { runs: 0, ticks: 0, messages: 0 };
  const start = performance.now();
  const plans = planScaling(input, counter, { remaining: 1_000_000 });
  return { ...counter, ms: performance.now() - start, plans };
}
const before: ReturnType<typeof measure>[] = [],
  after: ReturnType<typeof measure>[] = [];
// Each complete planner invocation gets its own runner hang backstop.
for (const mode of ["before", "after"] as const)
  it.each([0, 1, 2, 3])(`Black Friday planner measurement ${mode} %i`, () => {
    const result = measure(mode === "before" ? previous : d);
    (mode === "before" ? before : after).push(result);
    console.info("Black Friday planScaling", mode, JSON.stringify(result));
    expect(result.runs).toBeGreaterThan(0);
  });

it("the read-only deploy story adds no autoscaler sizing playback", () => {
  expect(before).toHaveLength(4);
  expect(after).toHaveLength(4);
  expect(after.map(({ runs, ticks, messages }) => ({ runs, ticks, messages }))).toEqual(
    before.map(({ runs, ticks, messages }) => ({ runs, ticks, messages })),
  );
  expect(after[0].plans.find((p) => p.simulation === "edge-deploy")).toMatchObject({
    reason: "policy",
    runs: 0,
    ticks: 0,
  });
});
