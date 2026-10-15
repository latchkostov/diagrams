import { createSimulationRun } from "./simulation";
import { LifecycleBudgetError } from "../model/resourceBudget";
import * as resourceBudgets from "../model/resourceBudget";
import { expect, it, vi } from "vitest";
import { autoscalingFixture } from "../lab/autoscalingFixture";
import { hpaLesson, resourceLesson } from "../model/autoscaling";
import { upgradeAutoscaling } from "../planning/migration";
import { countingReads } from "../test/complexity";
import { createEngine } from "./engine";
import { analyzeCapacity } from "./capacity";
import * as fleets from "./autoscaling";
import * as sampled from "./sampledResources";
import { assertResourceInvariants, type ResourceState } from "./resourceInvariants";
import { realFrame } from "./units";

function fixed() {
  const d = autoscalingFixture();
  Object.assign(d.nodes[1].props!, { autoscaling: { mode: "off" }, concurrency: 1, latencyMs: 10 });
  return d;
}
function load(d = fixed(), scale = 1) {
  const e = createEngine({ seed: 42, scale, verifyResources: assertResourceInvariants });
  e.load(d);
  return e;
}

it.each([undefined, 2000])("intersects admission, endpoint durations and CPU execution (%s)", (duration) => {
  const d = fixed();
  Object.assign(d.nodes[1].props!, {
    api: {},
    resources: { ...resourceLesson(), cpuMsPerMessage: 1000, cpuLimitMilli: 1000 },
    ...(duration ? { endpoints: [{ id: "slow", method: "GET", path: "/", behaviour: { latencyMs: duration } }] } : {}),
  });
  if (duration) d.edges[0].props = { ...d.edges[0].props, endpointId: "slow" };
  const expected = duration ? 0.5 : 1;
  expect(analyzeCapacity(d).nodes.worker.capacity).toBe(expected);
  const e = load(d);
  e.setTraffic(true);
  e.step(10_000);
  expect(e.frame().nodes.worker.processed).toBeGreaterThan(0);
  expect(e.frame().nodes.worker.processed).toBeLessThanOrEqual(10 * expected);
  // Broker routing weights must also intersect CPU, not just the final overlay.
  d.nodes[0].stencil = "aws.sqs";
  d.nodes[0].props = {};
  expect(analyzeCapacity(d).nodes.source.capacity).toBe(expected);
});

it("retained retries keep equivalent memory throughout backoff and repeated attempts at sampled scales", () => {
  const run = (scale: number) => {
    const d = fixed(),
      a = hpaLesson();
    d.nodes[0].stencil = "kafka.topic";
    d.nodes[0].props = { partitions: 10, maxDeliveryCount: 5 };
    d.edges[0].kind = "async";
    Object.assign(a.controller, { initialReplicas: 10, maxReplicas: 30 });
    a.controller.settings.syncMs = 1000;
    a.controller.settings.up.selectPolicy = "Disabled";
    a.controller.settings.down.selectPolicy = "Disabled";
    a.controller.settings.metrics = [
      {
        source: { kind: "resource", resource: "memory" },
        target: { kind: "averageValue", value: 50 },
        windowMs: 1000,
        metricDelayMs: 0,
      },
    ];
    Object.assign(d.nodes[1].props!, {
      replicas: 10,
      api: {},
      latencyMs: 100,
      failureRate: 1,
      retry: "inplace",
      retryBackoffMs: 5000,
      autoscaling: a,
      resources: { ...resourceLesson(), cpuMsPerMessage: 0, baselineMemoryMiB: 0, memoryMiBPerMessage: 100 },
    });
    const e = load(d, scale);
    e.inject("source", 10 / scale);
    const samples = [];
    for (let i = 0; i < 12; i++) {
      e.step(1000);
      const s = realFrame(e.frame());
      expect(s.nodes.worker.inFlight).toBe(10);
      expect(s.nodes.worker.fleet!.decision!.raw).toBe(20);
      samples.push(s.nodes.worker.resources!.memoryMiB);
    }
    return samples;
  };
  const exact = run(1);
  for (const scale of [2, 10]) run(scale).forEach((value, i) => expect(value / exact[i]).toBeGreaterThan(0.95));
});

it("sampled drain preflight and reconciliation visit each attempt once during repeated partial-startup shrinks", () => {
  const f = fleets.createFleet(1),
    r = resourceLesson();
  r.startup = { delayMs: 5000, jitterFraction: 0.5 };
  fleets.reconcileFleet(f, 4000, r, 0, 42, "worker");
  fleets.advanceFleet(f, 5000);
  const working: sampled.SampledWork[] = [];
  for (let i = 0; i < 8; i++) working.push({ cpuParts: sampled.sampledParts(f, f.ready, 1_000_000, working)! });
  expect(f.ranges.length).toBeGreaterThan(100);
  for (let round = 0; round < 4; round++) {
    const before = f.ranges.slice(f.rangeHead).map((c) => ({ ...c }));
    const counted = working.map((w) => countingReads(w.cpuParts!));
    working.forEach((w, i) => {
      w.cpuParts = counted[i].items;
    });
    const parts = f.partBudget.used;
    const desired = Math.max(1, Math.floor(f.ready / 2));
    expect(sampled.canDrainSampled(f, desired, working)).toBe(true);
    fleets.reconcileFleet(f, desired, r, 5000 + round, 42, "worker");
    sampled.retainSampledDrains(f, before, working, 10_000);
    expect(counted.reduce((sum, c) => sum + c.reads(), 0)).toBeLessThan(parts * 8);
    expect(f.partBudget.used).toBe(working.reduce((sum, w) => sum + w.cpuParts!.length, 0));
    expect(f.draining).toBeGreaterThan(0);
    for (const w of working) for (const p of w.cpuParts!) expect(p.key).toBe(`${p.first}:${p.last}`);
  }
});

it("caches CPU interval keys across ticks and refreshes split boundaries", () => {
  const d = fixed();
  Object.assign(d.nodes[1].props!, {
    replicas: 10,
    api: {},
    concurrency: 4,
    latencyMs: 10_000,
    resources: { ...resourceLesson(), cpuMsPerMessage: 1000 },
  });
  const e = load(d, 10);
  e.inject("source", 1);
  e.step(100);
  expect(e.frame().nodes.worker).toMatchObject({ inFlight: 1, fleet: { ready: 10 } });
  const keys = vi.spyOn(sampled, "partKey");
  try {
    e.step(100);
    expect(keys).not.toHaveBeenCalled();
    e.setNodeProps("worker", { replicas: 5 });
    e.step(10);
    expect(e.frame().nodes.worker.fleet!.draining).toBe(5);
  } finally {
    keys.mockRestore();
  }
});

it("HPA proposals consume policy history only after successful reconciliation", () => {
  const f = fleets.createFleet(1),
    c = hpaLesson().controller,
    r = resourceLesson();
  f.samples = [{ at: 15_000, cpu: 15_000, occupancy: 1, ready: 1 }];
  const first = fleets.evaluateHpa(f, c, r, 15_000);
  expect(first.desired).toBe(5);
  expect(fleets.evaluateHpa(f, c, r, 15_000)).toEqual(first);
  expect(f.changes).toEqual([]);
  fleets.reconcileFleet(f, first.desired, r, 15_000, 42, "worker");
  fleets.commitScalingChange(f, 1, 15_000);
  expect(f.changes).toEqual([{ at: 15_000, delta: 4 }]);
  expect(fleets.evaluateHpa(f, c, r, 15_000).desired).toBe(5);
});

it("lowering concurrency preserves running work under invariant verification and gates new admission", () => {
  const d = fixed();
  Object.assign(d.nodes[1].props!, { concurrency: 4, latencyMs: 1000 });
  const e = load(d);
  e.inject("source", 10);
  e.step(100);
  expect(e.frame().nodes.worker.inFlight).toBe(4);
  e.setNodeProps("worker", { concurrency: 2 });
  e.step(100);
  expect(e.frame().nodes.worker).toMatchObject({ inFlight: 4, processed: 0 });
  e.step(1000);
  expect(e.frame().nodes.worker).toMatchObject({ inFlight: 2, processed: 4 });
});

it("the ownership oracle accepts old reservations but rejects new acquisitions above lowered concurrency", () => {
  const f = fleets.createFleet(1);
  f.ranges = [];
  f.active = 4;
  f.busy.set(1, { count: 4, cpu: 0, samples: [] });
  const node = {
    id: "worker",
    status: "up",
    activeReplicas: 1,
    fleet: f,
    props: { concurrency: 4, resources: resourceLesson() },
    working: Array.from({ length: 4 }, () => ({ replica: 1 })),
    pending: [],
  };
  const state: ResourceState = { time: 10, scale: 1, capacityMultiplier: 1, partBudget: f.partBudget, nodes: [node] };
  assertResourceInvariants(state);
  node.props.concurrency = 2;
  expect(() => assertResourceInvariants(state)).not.toThrow();
  // A restored checkpoint is first observed with existing reservations already above the new limit.
  expect(() => assertResourceInvariants({ ...state, nodes: [{ ...node, fleet: structuredClone(f) }] })).not.toThrow();
  node.working.push({ replica: 1 });
  f.busy.get(1)!.count++;
  f.active++;
  expect(() => assertResourceInvariants(state)).toThrow("new reservation exceeds replica concurrency");
});

it("rejects replacement admission above lowered concurrency", () => {
  const f = fleets.createFleet(1);
  f.ranges = [];
  f.active = 4;
  f.busy.set(1, { count: 4, cpu: 0, samples: [] });
  const node = {
    id: "worker",
    status: "up",
    activeReplicas: 1,
    fleet: f,
    props: { concurrency: 4, resources: resourceLesson() },
    working: Array.from({ length: 4 }, () => ({ replica: 1 })),
    pending: [],
  };
  const state: ResourceState = { time: 10, scale: 1, capacityMultiplier: 1, partBudget: f.partBudget, nodes: [node] };
  assertResourceInvariants(state);
  node.props.concurrency = 2;
  expect(() => assertResourceInvariants(state)).not.toThrow();
  node.working[0] = { replica: 1 };
  expect(() => assertResourceInvariants(state)).toThrow("new reservation exceeds replica concurrency");
});

it("sampled reservations retain memory after concurrency is lowered until they finish", () => {
  const run = (scale: number) => {
    const d = fixed();
    Object.assign(d.nodes[1].props!, {
      replicas: 10,
      concurrency: 4,
      latencyMs: 1000,
      api: { maxInFlight: 40 },
      resources: { ...resourceLesson(), cpuMsPerMessage: 0, baselineMemoryMiB: 0, memoryMiBPerMessage: 100 },
    });
    const e = load(d, scale);
    e.inject("source", 40 / scale);
    e.step(100);
    expect(realFrame(e.frame()).nodes.worker.inFlight).toBe(40);
    e.setNodeProps("worker", { concurrency: 1 });
    e.step(900);
    const memory = e.frame().nodes.worker.resources!.memoryMiB;
    expect(memory).toBeGreaterThan(380);
    e.step(16_000);
    expect(e.frame().nodes.worker.inFlight).toBe(0);
    expect(e.frame().nodes.worker.resources!.memoryMiB).toBe(0);
    return memory;
  };
  const exact = run(1);
  for (const scale of [2, 10]) {
    const ratio = run(scale) / exact;
    expect(ratio).toBeGreaterThan(0.95);
    expect(ratio).toBeLessThan(1.05);
  }
});

it.each([1, 10])("resource-less A1 upgrade preserves p3 playback at scale %s", (scale) => {
  const d = fixed();
  d.planning = { revision: "p3" };
  delete d.nodes[1].props!.resources;
  delete d.nodes[1].props!.autoscaling;
  const a = load(d, scale),
    b = load(upgradeAutoscaling(d), scale);
  a.setTraffic(true);
  b.setTraffic(true);
  for (const duration of [100, 1000, 5000, 10_000]) {
    a.step(duration);
    b.step(duration);
    expect(b.snapshot()).toEqual(a.snapshot());
    for (const n of Object.values(b.frame().nodes)) {
      expect(n.fleet).toBeUndefined();
      expect(n.resources).toBeUndefined();
    }
  }
  a.setTraffic(false);
  b.setTraffic(false);
  a.step(30_000);
  b.step(30_000);
  expect(b.snapshot()).toEqual(a.snapshot());
  expect(b.frame().inSystem).toBe(0);
});

it.each([false, true])(
  "refused runner operations preserve the next step including credit and timeline (resume=%s)",
  (resume) => {
    const d = fixed();
    d.nodes = [
      ...d.nodes,
      ...Array.from({ length: 24 }, (_, i) => ({ ...structuredClone(d.nodes[1]), id: `extra-${i}` })),
    ];
    for (const n of d.nodes.slice(1)) n.props!.replicas = 900;
    const make = () =>
      createSimulationRun(d, {
        id: "refusal",
        title: "Refusal",
        seed: 42,
        scale: 10,
        durationMs: 5000,
        traffic: [{ id: "input", node: "source", shape: { kind: "constant", ratePerSec: 137, durationMs: 5000 } }],
        timeline: [
          ...(resume ? [{ atMs: 1000, action: { do: "note" as const, text: "Wait", pause: true } }] : []),
          { atMs: 1000, action: { do: "inject", node: "source", count: 7 } },
          { atMs: 1000, action: { do: "props", node: "worker", props: { replicas: 2000 } } },
        ],
      });
    const a = make(),
      b = make();
    for (const run of [a, b]) {
      run.setSpeed(2);
      run.step(resume ? 500 : 497); // Keep a fractional tick in the non-note case.
      run.engine.setNodePropsBatch({ "extra-0": { replicas: 2000 }, "extra-1": { replicas: 2000 } });
    }
    const before = { state: a.state(), snapshot: a.engine.snapshot() };
    expect(() => (resume ? a.resume() : a.step(37))).toThrow(LifecycleBudgetError);
    expect({ state: a.state(), snapshot: a.engine.snapshot() }).toEqual(before);
    for (const run of [a, b]) {
      run.engine.setNodeProps("extra-0", { replicas: 900 });
      if (resume) run.resume();
      run.step(37);
    }
    expect(a.state()).toEqual(b.state());
    expect(a.engine.snapshot()).toEqual(b.engine.snapshot());
    expect(a.engine.frame().nodes.worker.fleet!.desired).toBe(2000);
  },
);

it("ordinary runner ticks do not checkpoint when no property action is reachable", () => {
  const run = createSimulationRun(fixed(), { id: "plain", title: "Plain", traffic: [], durationMs: 1000 });
  const checkpoint = vi.spyOn(run.engine, "checkpoint");
  run.step(500);
  expect(checkpoint).not.toHaveBeenCalled();
});

it.each(["p3", "p3-a1"] as const)("unrelated %s actions never checkpoint or preflight allocation", (revision) => {
  const d = fixed();
  d.planning = { revision };
  if (revision === "p3") {
    delete d.nodes[1].props!.resources;
    delete d.nodes[1].props!.autoscaling;
  }
  const run = createSimulationRun(d, {
    id: "plain",
    title: "Plain",
    traffic: [],
    durationMs: 1000,
    timeline: [
      {
        atMs: 10,
        action: {
          do: "props",
          node: "worker",
          props: revision === "p3" ? { replicas: 2 } : { concurrency: 2, failureRate: 0.2 },
        },
      },
    ],
  });
  const checkpoint = vi.spyOn(run.engine, "checkpoint"),
    validate = vi.spyOn(run.engine, "validateLifecycleActions");
  run.step(10);
  expect(checkpoint).not.toHaveBeenCalled();
  expect(validate).not.toHaveBeenCalled();
});

it("lifecycle preflight copies only three allocation fields per node, independent of queued work", () => {
  const run = createSimulationRun(fixed(), {
    id: "bounded",
    title: "Bounded",
    traffic: [],
    durationMs: 1000,
    timeline: [{ atMs: 10, action: { do: "props", node: "worker", props: { replicas: 2 } } }],
  });
  run.engine.inject("source", 50_000);
  const checkpoint = vi.spyOn(run.engine, "checkpoint"),
    budget = vi.spyOn(resourceBudgets, "resourceBudgetExceeded"),
    clone = vi.spyOn(globalThis, "structuredClone");
  try {
    run.step(10);
    expect(checkpoint).not.toHaveBeenCalled();
    const candidate = budget.mock.calls[0][0];
    expect(candidate.nodes).toHaveLength(2);
    for (const node of candidate.nodes) {
      expect(Object.keys(node)).toEqual(["id", "props"]);
      expect(Object.keys(node.props!)).toEqual(["resources", "replicas", "autoscaling"]);
    }
    // A scalar patch may be cloned; neither queued messages nor graph state may be.
    expect(clone.mock.calls.every(([value]) => typeof value !== "object")).toBe(true);
  } finally {
    budget.mockRestore();
    clone.mockRestore();
  }
});

it.each(["p3", "p3-a1"] as const)(
  "a %s allocation action on a deep connected graph does not clone the graph",
  (revision) => {
    const d = fixed();
    d.planning = { revision };
    d.nodes = Array.from({ length: 2000 }, (_, i) => ({
      id: `n${i}`,
      stencil: "service.dotnet",
      label: "Service",
      x: 0,
      y: 0,
    }));
    d.edges = d.nodes.slice(1).map((n, i) => ({ id: `e${i}`, from: `n${i}`, to: n.id }));
    const run = createSimulationRun(d, {
      id: "deep",
      title: "Deep",
      traffic: [],
      durationMs: 100,
      timeline: [{ atMs: 10, action: { do: "props", node: "n0", props: { replicas: 2 } } }],
    });
    expect(() => run.step(10)).not.toThrow();
    expect(run.engine.effectiveProps("n0").replicas).toBe(2);
  },
);

it("preflight stops at the actual tick, duration and pausing note boundaries", () => {
  const make = (note = false, durationMs = 100) =>
    createSimulationRun(fixed(), {
      id: "boundaries",
      title: "Boundaries",
      traffic: [],
      durationMs,
      timeline: [
        ...(note ? [{ atMs: 10, action: { do: "note" as const, text: "Wait", pause: true } }] : []),
        { atMs: 20, action: { do: "props", node: "worker", props: { replicas: 2 } } },
      ],
    });
  const a = make(),
    b = make(true),
    c = make(false, 10);
  const budget = vi.spyOn(resourceBudgets, "resourceBudgetExceeded").mockReturnValue(true);
  try {
    a.step(19);
    expect(a.state().time).toBe(10);
    expect(() => a.step(1)).toThrow(LifecycleBudgetError);
    expect(a.state().time).toBe(10);
    expect(() => b.step(100)).not.toThrow();
    expect(b.state().waiting).toBe(true);
    expect(() => b.resume()).not.toThrow(); // The refused edit is still a future tick.
    expect(() => b.step(10)).toThrow(LifecycleBudgetError);
    expect(() => c.step(100)).not.toThrow();
    expect(c.state().done).toBe(true);
  } finally {
    budget.mockRestore();
  }
});
