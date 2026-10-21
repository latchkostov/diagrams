import { expect, it } from "vitest";
import { advanceHeadless, createHeadlessRun, startWork } from "./headless";
import { WorkBudgetError } from "./engine";
import { LiveController } from "../live/controller";
import { waitingFixture } from "../lab/waitingFixture";

it("counts downstream copies against the allocation cap before allocating them", () => {
  const d = waitingFixture();
  d.nodes = [
    d.nodes[0],
    ...Array.from({ length: 3 }, (_, i) => ({ ...d.nodes[1], id: `worker-${i}`, props: { latencyMs: 0, jitter: 0 } })),
  ];
  d.edges = d.nodes.slice(1).map((n, i) => ({ id: `fan-${i}`, from: "source", to: n.id, kind: "async" }));
  const sim = {
    id: "copies",
    title: "Copies",
    scale: 1,
    durationMs: 100,
    traffic: [{ id: "one", node: "source", shape: { kind: "burst" as const, count: 1 } }],
  };
  const budget = { remaining: 2 };
  expect(startWork(d, sim)).toBe(4);
  expect(() => advanceHeadless(createHeadlessRun(d, sim, budget), 100)).toThrow(WorkBudgetError);
  expect(budget.remaining).toBe(-1);
});

it("replays free play's actual seed, scale, rates, capacity, manual injections and fault controls", () => {
  const d = waitingFixture();
  d.nodes.push({ ...d.nodes[1], id: "unconnected" });
  const c = new LiveController(d, { seed: 42 });
  try {
    c.setInputs({ rates: { source: 8 }, props: {}, capacity: 2, scale: 2 });
    c.flush();
    c.setTraffic(true);
    c.step(500);
    c.inject("source", 10);
    c.injectAtSources(4);
    c.setFault({ kind: "slow", node: "partner", factor: 10 });
    c.step(500);
    c.setTraffic(false);
    c.step(500);
    const context = structuredClone(c.verificationContext());
    const run = createHeadlessRun(d, context.simulation, { remaining: 10000 }, context);
    advanceHeadless(run, c.snapshot().time);
    expect(context.simulation.seed).toBe(42);
    expect(context.simulation.scale).toBe(2);
    expect(run.engine.snapshot().nodes).toEqual(c.snapshot().nodes);
    expect(run.engine.snapshot().edges).toEqual(c.snapshot().edges);
  } finally {
    c.dispose();
  }
});

it("keeps traffic inherited at a new run's origin before a later traffic-off control", () => {
  const d = waitingFixture();
  const c = new LiveController(d);
  try {
    c.setTraffic(true);
    c.restart();
    c.step(500);
    c.setTraffic(false);
    c.step(500);
    const context = c.verificationContext();
    expect(context.initialTraffic).toBe(true);
    const run = createHeadlessRun(d, context.simulation, { remaining: 10000 }, context);
    advanceHeadless(run, c.snapshot().time);
    expect(run.engine.snapshot().nodes).toEqual(c.snapshot().nodes);
  } finally {
    c.dispose();
  }
});
