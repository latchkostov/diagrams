import { describe, it, expect } from "vitest";
import { planScaling, planWork, PLANNER_LIMITS } from "./scalingPlanner";
import { plannerFixture } from "../lab/plannerFixture";
import type { DiagramFile } from "../model/types";
import type { AppServiceController, AutoscalingConfig } from "../model/autoscaling";
import { cloudFixture } from "../lab/cloudFixture";
import busy from "../examples/scale-on-busy-threads.json";
import type { VerificationContext } from "./headless";
import { createEngine, WorkBudgetError } from "./engine";

const plan = (d: DiagramFile) => planScaling(structuredClone(d))[0];

describe("scenario sizing planner", () => {
  it("reproduces 3× / max 10 / 92% / target 70% → max 14, verified by a same-seed rerun", () => {
    const p = plan(plannerFixture());
    expect(p).toMatchObject({ simulation: "black-friday", traffic: 3, status: "planned" });
    const [s] = p.suggestions;
    expect(s).toMatchObject({ node: "worker", adapter: "hpa", kind: "max", from: 10, to: 14, wanted: 14, target: 70 });
    expect(s.metric).toBeGreaterThan(91);
    expect(s.metric).toBeLessThanOrEqual(92.5);
    expect(s.verified?.maxed).toBe(false);
    const a = s.fix![0].props.autoscaling as AutoscalingConfig & { mode: "on" };
    expect(a.controller.maxReplicas).toBe(14);
    expect(p.runs).toBe(2);
  });
  it("replaces a max fix with partitions when the input's partitions bound the useful readers", () => {
    const p = plan(plannerFixture("partitions", 60));
    expect(p.suggestions[0]).toMatchObject({ kind: "partitions", broker: "orders", from: 10 });
    expect(p.suggestions[0].to).toBeGreaterThan(10);
    expect(p.suggestions[0].fix![0]).toEqual({ node: "orders", props: { partitions: p.suggestions[0].to } });
    expect(p.suggestions[0].verified!.endBacklog).toBeLessThan(p.suggestions[0].endBacklog);
  });
  it("offers no replica fix when an admission quota binds", () => {
    const p = plan(plannerFixture("quota", 60));
    expect(p.suggestions[0]).toMatchObject({ kind: "quota" });
    expect(p.suggestions[0].fix).toBeUndefined();
    expect(p.suggestions[0].verified!.rejected).toBeGreaterThan(0);
  });
  it("suggests a warm minimum only when a backlog goal fails while replicas start", () => {
    const d = plannerFixture("http", 10);
    expect(plan(d).suggestions).toEqual([]);
    d.simulations![0].expectations = [
      {
        id: "fast",
        label: "Orders never queue",
        metric: { node: "worker", field: "backlog" },
        op: "<",
        value: 5,
        when: "always",
      },
    ];
    const p = plan(d);
    const [s] = p.suggestions;
    expect(s).toMatchObject({ kind: "min", from: 1 });
    expect(s.startupBacklog).toBeGreaterThan(0);
    expect(s.verified!.startupBacklog).toBeLessThan(s.startupBacklog);
    expect(s.fix).toBeDefined();
  });
  it("reports unavailable when the planning budget is exceeded, before running anything", () => {
    const d = plannerFixture();
    for (let i = 0; i < 800; i++)
      d.nodes.push({ id: `filler-${i}`, stencil: "service.dotnet", label: `Filler ${i}`, x: 0, y: i * 10, props: {} });
    expect(planWork(d)).toBeGreaterThan(PLANNER_LIMITS.work);
    const counter = { ticks: 0, runs: 0 };
    const [p] = planScaling(d, counter);
    expect(p).toMatchObject({ status: "unavailable", reason: "budget", suggestions: [] });
    expect(counter).toEqual({ ticks: 0, runs: 0, messages: 0 });
  });
  it("bounds runs per simulation however many scalers it verifies (8× scalers, same runs and ticks)", () => {
    const counts = [1, 8].map((n) => {
      const d = plannerFixture();
      d.simulations![0].durationMs = 220_000;
      for (let i = 1; i < n; i++) {
        d.nodes.push({ ...structuredClone(d.nodes[1]), id: `worker-${i}`, y: 180 + i * 120 });
        d.edges.push({ ...d.edges[0], id: `requests-${i}`, to: `worker-${i}` });
      }
      const counter = { ticks: 0, runs: 0 };
      const [p] = planScaling(d, counter);
      return { runs: counter.runs, ticks: counter.ticks, suggestions: p.suggestions.length };
    });
    expect(counts[1].suggestions).toBe(8);
    expect(counts[1].runs).toBe(counts[0].runs);
    expect(counts[1].ticks).toBe(counts[0].ticks);
    expect(counts[1].runs).toBeLessThanOrEqual(PLANNER_LIMITS.runs);
  }, 60_000);
  it("is deterministic and memoized on the diagram's simulation-relevant content", () => {
    const d = plannerFixture();
    const a = planScaling(d),
      b = planScaling(structuredClone(d));
    expect(b).toBe(a);
    const counter = { ticks: 0, runs: 0 };
    planScaling(structuredClone(d), counter);
    expect(counter.runs).toBe(0);
  });
  it("skips a node whose simulation sets its own policy", () => {
    const d = plannerFixture();
    d.simulations![0].setup = { props: { worker: { autoscaling: { mode: "off" } } } };
    expect(plan(d)).toMatchObject({ status: "unavailable", reason: "policy" });
  });
});

describe("scenario sizing targets", () => {
  it("lowers a target the backlog-bound fleet never reached, and verifies it", () => {
    const d = cloudFixture("app-service");
    const a = d.nodes[1].props!.autoscaling as { controller: AppServiceController };
    Object.assign(a.controller, { evaluationMs: 5000, maxReplicas: 5 });
    Object.assign(a.controller.rules[0], { windowMs: 10_000, cooldownMs: 15_000 });
    Object.assign(a.controller.rules[1], { windowMs: 10_000, cooldownMs: 20_000 });
    d.simulations = [
      {
        id: "sale",
        title: "Flash sale",
        seed: 17,
        durationMs: 150_000,
        traffic: [{ id: "sale", node: "source", shape: { kind: "constant", ratePerSec: 40, durationMs: 60_000 } }],
      },
    ];
    const [s] = plan(d).suggestions;
    // Slot-bound at 64% CPU, a 70% scale-out rule never fires while the queue grows.
    expect(s).toMatchObject({ kind: "target", from: 70, to: 57, adapter: "appService", metricKind: "cpu" });
    const fixed = s.fix![0].props.autoscaling as { controller: AppServiceController };
    expect(fixed.controller.rules[0].threshold).toBe(57);
    expect(s.verified!.backlog).toBeLessThan(s.backlog);
  });
});

describe("planner bounds and cache (review round 1)", () => {
  it("plans again when a source rename changes what a filter passes; a connection's label or position doesn't", () => {
    const d = plannerFixture();
    // The filter passes the source's messages: its label names them.
    d.edges[0].props = { ...d.edges[0].props, filter: ["Traffic"] };
    expect(planScaling(d)[0].suggestions[0]).toMatchObject({ kind: "max", to: 14 });
    const cosmetic = structuredClone(d);
    Object.assign(cosmetic.edges[0], { label: "orders", sourceSide: "right" });
    cosmetic.nodes[0].x += 200;
    const quiet = { ticks: 0, runs: 0 };
    planScaling(cosmetic, quiet);
    expect(quiet.runs).toBe(0);
    const renamed = structuredClone(d);
    renamed.nodes[0].label = "Other";
    const counter = { ticks: 0, runs: 0 };
    const [p] = planScaling(renamed, counter);
    expect(counter.runs).toBeGreaterThan(0);
    expect(p.suggestions).toEqual([]);
  });
  it("returns unavailable, not an exception, when verifying a fix would pass the lifecycle budget", () => {
    const d = plannerFixture();
    // Nine 2,500-replica services and one of 2,490 bring the diagram to the 100,000 lifecycle budget with max 10.
    for (let i = 0; i < 10; i++)
      d.nodes.push({
        id: `fixed-${i}`,
        stencil: "service.dotnet",
        label: `Fixed ${i}`,
        x: 0,
        y: 400 + i * 10,
        props: { replicas: i < 9 ? 2500 : 2490, resources: d.nodes[1].props!.resources },
      });
    const [p] = planScaling(d);
    expect(p).toMatchObject({ status: "unavailable", reason: "budget", suggestions: [] });
  });
  it("refuses compounded fan-out before running: one message through eight ten-way stages", () => {
    const d = plannerFixture();
    d.simulations![0].traffic = [{ id: "one", node: "source", shape: { kind: "burst", count: 1 } }];
    d.simulations![0].multipliers = { traffic: 1 };
    d.simulations![0].durationMs = 10_000;
    let previous = ["source"];
    d.edges = [];
    for (let stage = 0; stage < 8; stage++) {
      const next: string[] = [];
      for (const from of previous.slice(0, 1))
        for (let k = 0; k < 10; k++) {
          const id = `s${stage}-${k}`;
          d.nodes.push({ id, stencil: "service.dotnet", label: id, x: 0, y: 0, props: { latencyMs: 0 } });
          d.edges.push({ id: `${from}-${id}`, from, to: id, kind: "async", props: { travelMs: 0 } });
          next.push(id);
        }
      // Every node of a stage feeds every node of the next: 10 × 10 × … copies.
      if (stage > 0)
        for (const from of previous.slice(1))
          for (const to of next) d.edges.push({ id: `${from}-${to}`, from, to, kind: "async", props: { travelMs: 0 } });
      previous = next;
    }
    d.edges.push({ id: "to-worker", from: "source", to: "worker", kind: "async", props: { travelMs: 0 } });
    const counter = { ticks: 0, runs: 0 };
    const [p] = planScaling(d, counter);
    expect(p).toMatchObject({ status: "unavailable", reason: "start" });
    expect(counter.runs).toBe(0);
  });
  it("stops a run at the message budget: a copying cycle the preflight can't see", () => {
    const d = plannerFixture();
    d.simulations![0].traffic = [{ id: "few", node: "source", shape: { kind: "burst", count: 10 } }];
    d.simulations![0].multipliers = { traffic: 1 };
    // a ⇄ b, each also copying on: every pass doubles the messages.
    d.nodes.push(
      { id: "a", stencil: "service.dotnet", label: "A", x: 0, y: 0, props: { latencyMs: 0 } },
      { id: "b", stencil: "service.dotnet", label: "B", x: 0, y: 0, props: { latencyMs: 0 } },
    );
    d.edges.push(
      { id: "s-a", from: "source", to: "a", kind: "async", props: { travelMs: 10 } },
      { id: "a-b", from: "a", to: "b", kind: "async", props: { travelMs: 10 } },
      { id: "a-b2", from: "a", to: "b", kind: "async", props: { travelMs: 10 } },
      { id: "b-a", from: "b", to: "a", kind: "async", props: { travelMs: 10 } },
      { id: "b-a2", from: "b", to: "a", kind: "async", props: { travelMs: 10 } },
    );
    const counter: { ticks: number; runs: number; messages?: number } = { ticks: 0, runs: 0 };
    // A small budget keeps the test quick; the shipped one is the same check.
    const limits = PLANNER_LIMITS as { messages: number };
    const shipped = limits.messages;
    limits.messages = 20_000;
    try {
      const [p] = planScaling(d, counter);
      expect(p).toMatchObject({ status: "unavailable", reason: "budget" });
    } finally {
      limits.messages = shipped;
    }
    expect(counter.messages).toBeLessThanOrEqual(20_001);
  });
  it("the engine refuses the message past its shared budget, before creating it", () => {
    const budget = { remaining: 100 };
    const e = createEngine({ seed: 1, messageBudget: budget });
    e.load(plannerFixture());
    e.inject("source", 10);
    expect(() => e.step(1000)).not.toThrow();
    expect(budget.remaining).toBeLessThan(100);
    expect(() => e.inject("source", 200)).toThrow(WorkBudgetError);
    expect(budget.remaining).toBe(-1);
  });
  it("counts a broker group once however many parallel connections read it", () => {
    const d = plannerFixture("partitions", 60);
    const once = plan(d).suggestions[0];
    d.edges.push({ ...d.edges[0], id: "consume-again" });
    const twice = plan(d).suggestions[0];
    expect(twice.endBacklog).toBe(once.endBacklog);
    expect(twice.backlog).toBe(once.backlog);
  });
  it("finds scalers in work linear in the diagram (8× scalers and connections)", () => {
    const reads = [500, 4000].map((n) => {
      const d = plannerFixture();
      for (let i = 0; i < n; i++) {
        d.nodes.push({ id: `q${i}`, stencil: "azure.service-bus.queue", label: `Q${i}`, x: 0, y: 0, props: {} });
        d.nodes.push({ id: `w${i}`, stencil: "service.dotnet", label: `W${i}`, x: 0, y: 0, props: d.nodes[1].props });
        d.edges.push({ id: `e${i}`, from: `q${i}`, to: `w${i}`, kind: "async", props: {} });
      }
      let count = 0;
      const edges = d.edges;
      d.edges = new Proxy(edges, {
        get(target, key, receiver) {
          if (typeof key === "string" && /^\d+$/.test(key)) count++;
          return Reflect.get(target, key, receiver);
        },
      });
      // Over the work budget: unavailable without a run, after finding every scaler.
      expect(planScaling(d)[0]).toMatchObject({ status: "unavailable", reason: "budget" });
      return count;
    });
    expect(reads[1] / reads[0]).toBeLessThan(10);
  });
});

it("keeps planner sampling independent of redundant replay-control boundaries", () => {
  const d = structuredClone(busy) as DiagramFile;
  const sim = d.simulations![0];
  sim.durationMs = 10000;
  sim.timeline = [];
  const context: VerificationContext = {
    revision: 1,
    origin: { diagram: d, simulation: sim, initialTraffic: false },
    controls: Array.from({ length: 99 }, (_, i) => ({ time: (i + 1) * 100, op: { kind: "traffic", on: false } })),
  };
  const baseline = planScaling(d, { ticks: 0, runs: 0 }, { remaining: 100000 });
  expect(planScaling(d, { ticks: 0, runs: 0 }, { remaining: 100000 }, context)).toEqual(baseline);
});

it("counts a recorded control at the horizon in the planner's last sample", () => {
  // Review 20261021-141142 P1: 2,000 messages injected at the end of the busy-thread run stay queued.
  const d = structuredClone(busy) as DiagramFile;
  const sim = d.simulations![0];
  const context: VerificationContext = {
    revision: 1,
    origin: { diagram: d, simulation: sim, initialTraffic: false },
    controls: [{ time: 50_000, op: { kind: "inject", node: "applications", count: 2000 } }],
  };
  const [plan] = planScaling({ ...d, simulations: [sim] }, { ticks: 0, runs: 0 }, { remaining: 1_000_000 }, context);
  const suggestion = plan.suggestions.find((s) => s.verified);
  expect(suggestion).toBeDefined();
  expect(suggestion!.verified!.endBacklog).toBeGreaterThanOrEqual(2000);
});

it("sizes against a Capacity reduction the live run recorded, as against the same reduction in the simulation", () => {
  // Review 20261021-141142 P2: playback saturates at 2 replicas after Capacity × 0.5; the planner must see that too.
  const d = structuredClone(busy) as DiagramFile;
  const caller = d.nodes.find((n) => n.id === "caller")!;
  const a = caller.props!.autoscaling as AutoscalingConfig;
  if (a.mode !== "on" || a.controller.kind !== "hpa") throw new Error("Fixture needs an HPA");
  a.controller.maxReplicas = a.controller.minReplicas = a.controller.initialReplicas = 4;
  a.controller.settings.metrics[0].source = { kind: "pods", metric: "busyThreads" };
  const sim = d.simulations![0];
  const scripted = planScaling(
    { ...d, simulations: [{ ...sim, multipliers: { capacity: 0.5 } }] },
    { ticks: 0, runs: 0 },
    { remaining: 1_000_000 },
  )[0].suggestions.find((s) => s.node === "caller");
  expect(scripted).toMatchObject({ kind: "max", verified: expect.anything() });
  const context: VerificationContext = {
    revision: 1,
    origin: { diagram: d, simulation: sim, initialTraffic: false },
    controls: [{ time: 0, op: { kind: "configuration", patches: {}, multipliers: { traffic: 1, capacity: 0.5 } } }],
  };
  const recorded = planScaling(
    { ...d, simulations: [sim] },
    { ticks: 0, runs: 0 },
    { remaining: 1_000_000 },
    context,
  )[0].suggestions.find((s) => s.node === "caller");
  expect(recorded).toMatchObject({ kind: "max", from: 4, verified: expect.anything() });
  expect(recorded!.to).toBe(scripted!.to);
});

it("sizes from decisions made at the Capacity × in force, not one a recorded change replaced", () => {
  // Review 20261021-150030: Traffic ×6 / Capacity ×2 for 240 s, then a recorded Traffic ×3 / Capacity ×0.5.
  // The ×2 decision (27 replicas) must not be read at ×0.5 (an authored maximum of 54); 28 already drains it.
  const d = plannerFixture();
  const sim = d.simulations![0];
  sim.durationMs = 480_000;
  sim.traffic[0].shape = { kind: "constant", ratePerSec: 115 / 3, durationMs: 480_000 };
  sim.multipliers = { traffic: 6, capacity: 2 };
  const context: VerificationContext = {
    revision: 1,
    origin: { diagram: d, simulation: sim, initialTraffic: false },
    controls: [
      { time: 240_000, op: { kind: "configuration", patches: {}, multipliers: { traffic: 3, capacity: 0.5 } } },
    ],
  };
  const [plan] = planScaling(d, { ticks: 0, runs: 0 }, { remaining: 1_000_000 }, context);
  const max = plan.suggestions.find((s) => s.kind === "max");
  // The normalized maximum is applicable and verified: it drains the replay, and it's what the fix writes.
  expect(max).toMatchObject({ to: 28, verified: { maxed: false, endBacklog: 0 } });
  expect(max!.fix).toEqual([
    {
      node: "worker",
      props: { autoscaling: expect.objectContaining({ controller: expect.objectContaining({ maxReplicas: 28 }) }) },
    },
  ]);
});

it("keeps each refined peak with the Capacity × it was wanted under", () => {
  // Review 20261021-153556: Traffic ×1 / Capacity ×0.25, then a recorded Traffic ×10 / Capacity ×1 at 240 s. The
  // refined peak is wanted at ×1; reading it at the first observation's ×0.25 stopped refinement early at 37.
  const d = plannerFixture();
  const sim = d.simulations![0];
  sim.durationMs = 480_000;
  sim.traffic[0].shape = { kind: "constant", ratePerSec: 115 / 3, durationMs: 480_000 };
  sim.multipliers = { traffic: 1, capacity: 0.25 };
  const context: VerificationContext = {
    revision: 1,
    origin: { diagram: d, simulation: sim, initialTraffic: false },
    controls: [
      { time: 240_000, op: { kind: "configuration", patches: {}, multipliers: { traffic: 10, capacity: 1 } } },
    ],
  };
  const [plan] = planScaling(d, { ticks: 0, runs: 0 }, { remaining: 1_000_000 }, context);
  const max = plan.suggestions.find((s) => s.kind === "max");
  expect(max).toMatchObject({ to: 44, verified: { maxed: false } });
  expect(max!.fix).toBeDefined();
});
