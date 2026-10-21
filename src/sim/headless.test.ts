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
    const run = createHeadlessRun(d, context.origin.simulation, { remaining: 10000 }, context);
    advanceHeadless(run, c.snapshot().time);
    expect(context.origin.simulation.seed).toBe(42);
    expect(context.origin.simulation.scale).toBe(2);
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
    expect(context.origin.initialTraffic).toBe(true);
    const run = createHeadlessRun(d, context.origin.simulation, { remaining: 10000 }, context);
    advanceHeadless(run, c.snapshot().time);
    expect(run.engine.snapshot().nodes).toEqual(c.snapshot().nodes);
  } finally {
    c.dispose();
  }
});

it.each([501, 502, 503, 504, 50001])("reaches a %s ms horizon that ends between engine ticks", (durationMs) => {
  const d = waitingFixture();
  const run = createHeadlessRun(
    d,
    { id: "fractional", title: "Fractional", durationMs, traffic: [] },
    { remaining: 100 },
  );
  advanceHeadless(run, durationMs);
  expect(run.state().done).toBe(true);
  expect(run.state().time).toBe(Math.ceil(durationMs / 10) * 10);
});

it("samples once per simulated second whatever replay controls split the steps", () => {
  const d = waitingFixture();
  const sim = {
    id: "plain",
    title: "Plain",
    durationMs: 5000,
    traffic: [{ id: "load", node: "source", shape: { kind: "constant" as const, ratePerSec: 25, durationMs: 5000 } }],
    timeline: [{ atMs: 1500, action: { do: "note" as const, text: "Pause", pause: true } }],
  };
  const times = (controls: { time: number; op: { kind: "traffic"; on: false } }[]) => {
    const run = createHeadlessRun(
      d,
      sim,
      { remaining: 100000 },
      {
        revision: 0,
        origin: { diagram: d, simulation: sim, initialTraffic: false },
        controls,
      },
    );
    const seen: number[] = [];
    advanceHeadless(run, 5000, () => seen.push(run.state().time));
    return seen;
  };
  const plain = times([]);
  expect(plain).toEqual([1000, 1500, 2500, 3500, 4500, 5000]);
  expect(
    times(Array.from({ length: 49 }, (_, i) => ({ time: (i + 1) * 100, op: { kind: "traffic", on: false } }))),
  ).toEqual(plain);
});

it("applies the controls due at a boundary before sampling it, the last one included", () => {
  const d = waitingFixture();
  const sim = { id: "end", title: "End", scale: 1, durationMs: 2000, traffic: [] };
  const run = createHeadlessRun(
    d,
    sim,
    { remaining: 100000 },
    {
      revision: 0,
      origin: { diagram: d, simulation: sim, initialTraffic: false },
      controls: [
        { time: 1000, op: { kind: "status", node: "caller", status: "paused" } },
        { time: 2000, op: { kind: "inject", node: "caller", count: 7 } },
      ],
    },
  );
  const seen: [number, string, number][] = [];
  advanceHeadless(run, 2000, () => {
    const caller = run.engine.snapshot().nodes.caller;
    seen.push([run.state().time, caller.status, caller.backlog]);
  });
  expect(seen).toEqual([
    [1000, "paused", 0],
    [2000, "paused", 7],
  ]);
});
