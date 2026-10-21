import { expect, it } from "vitest";
import payment from "../examples/slow-payment-provider.json";
import busy from "../examples/scale-on-busy-threads.json";
import type { DiagramFile } from "../model/types";
import { confirmedThreadFix } from "./threadFixPlan";
import { planScaling } from "../sim/scalingPlanner";
import { LiveController } from "./controller";
import { TroubleTracker } from "./useObservedTrouble";
import { planDescriptor } from "../planning/scalingPlanText";

const exhausted = (node: string, edge: string) => ({
  key: `threads-exhausted:${node}`,
  kind: "threads-exhausted" as const,
  node,
  headline: "",
  announce: "",
  detail: "",
  action: { kind: "free-thread" as const, edge },
});

it("chooses the inspector's verified busy-thread policy before changing call semantics", async () => {
  const d = busy as DiagramFile;
  const simulation = d.simulations![0];
  const plan = planScaling(d).find((p) => p.simulation === simulation.id)!;
  const fix = confirmedThreadFix(d, { simulation, trouble: exhausted("caller", "call"), time: 15000 });
  expect(fix).toEqual({
    kind: "scale-threads",
    changes: plan.suggestions[0].fix,
    plan: planDescriptor(plan, plan.suggestions[0], (id) => d.nodes.find((n) => n.id === id)?.label ?? id),
  });
  const c = new LiveController(d);
  const tracker = new TroubleTracker(c, async (diagram, request) => confirmedThreadFix(diagram, request));
  const stop = tracker.subscribe(() => {});
  try {
    c.selectSimulation(simulation);
    for (let i = 0; i < 150; i++) c.step(100);
    await Promise.resolve();
    expect(tracker.current()?.action).toEqual(fix);
  } finally {
    stop();
    c.dispose();
  }
});

it("confirms an affordable timeout and rejects a timeout that leaves the caller exhausted", () => {
  const d = payment as DiagramFile;
  const trouble = {
    ...exhausted("checkout", "pay"),
    action: { kind: "add-timeout" as const, edge: "pay", deadlineMs: 600 },
  };
  const request = { simulation: d.simulations![0], trouble, time: 15000 };
  expect(confirmedThreadFix(d, request)).toEqual(trouble.action);
  expect(
    confirmedThreadFix(d, { ...request, trouble: { ...trouble, action: { ...trouble.action, deadlineMs: 1000 } } }),
  ).toEqual({ kind: "free-thread", edge: "pay" });
});

it("rejects an over-budget scenario rather than offering a speculative fix", () => {
  const d = structuredClone(payment) as DiagramFile;
  d.nodes = Array.from({ length: 10000 }, (_, i) => ({ ...d.nodes[2], id: `n${i}` }));
  expect(
    confirmedThreadFix(d, { simulation: d.simulations![0], trouble: exhausted("checkout", "pay"), time: 15000 }),
  ).toBeUndefined();
});
