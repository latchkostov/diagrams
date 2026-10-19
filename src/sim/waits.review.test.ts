import { expect, it, vi } from "vitest";
import fc from "fast-check";
import { waitingFixture } from "../lab/waitingFixture";
import { cloudFixture } from "../lab/cloudFixture";
import { resourceLesson } from "../model/autoscaling";
import { propertyRuns } from "../test/fastCheck";
import { createEngine } from "./engine";
import { analyzeCapacity } from "./capacity";
import { realSnapshot } from "./units";
import { createSimulationRun } from "./simulation";

it.each(["generic.database", "generic.external-api", "generic.queue", "generic.topic", "azure.event-hubs"])(
  "ignores outgoing Requests from a terminal or broker (%s)",
  (stencil) => {
    const d = waitingFixture();
    d.nodes[2] = { ...d.nodes[2], stencil, props: { latencyMs: 20, api: { latencyMs: 20 }, jitter: 0 } };
    d.nodes.push({ ...d.nodes[1], id: "unused", props: { latencyMs: 10_000, jitter: 0 } });
    d.edges.push({ id: "unused-call", from: "partner", to: "unused", kind: "sync" });
    const plan = analyzeCapacity(d);
    expect(plan.nodes.caller.waits?.holdMs ?? 10).toBe(
      10 + (plan.resolved.partner.admission?.api.latencyMs ?? plan.resolved.partner.latencyMs),
    );
    expect(plan.nodes.partner.waits).toBeUndefined();
    const e = createEngine({ seed: 17 });
    e.load(d);
    e.inject("source", 1);
    e.step(100);
    expect(e.snapshot().nodes.caller.processed).toBe(1);
    expect(e.snapshot().nodes.partner.threads).toBeUndefined();
  },
);

it.each(["generic.service", "aws.lambda"])("uses hold time in every capacity lane (%s)", (stencil) => {
  const d = waitingFixture();
  d.nodes[0].props!.ratePerSec = 100;
  d.nodes[1].stencil = stencil;
  Object.assign(d.nodes[1].props!, {
    scaling: "fixed",
    maxConcurrency: 4,
    api: { latencyMs: 10 },
    resources: { ...resourceLesson(), cpuMsPerMessage: 1 },
  });
  const plan = analyzeCapacity(d).nodes.caller;
  expect(plan.waits?.holdMs).toBe(260);
  expect(plan.capacity).toBeCloseTo(4000 / 260);
  if (stencil === "generic.service") {
    expect(plan.resourcePlan?.initialCapacity).toBeCloseTo(plan.capacity);
    expect(plan.resourcePlan?.maxCapacity).toBeCloseTo(plan.capacity);
    expect(plan.resourcePlan?.cpuRequestPct).toBe((100 * 100) / resourceLesson().cpuRequestMilli!);
  }
});

it.each(["generic.service", "azure.functions"])(
  "includes endpoint work overrides in held occupancy (%s)",
  (stencil) => {
    const d = waitingFixture();
    d.nodes[0].props!.ratePerSec = 100;
    d.nodes[1].stencil = stencil;
    Object.assign(d.nodes[1].props!, {
      scaling: "fixed",
      resources: { ...resourceLesson(), cpuMsPerMessage: 1 },
      endpoints: [{ id: "slow", method: "GET", path: "/", behaviour: { latencyMs: 50 } }],
    });
    d.edges[0].kind = "sync";
    d.edges[0].props!.endpointId = "slow";
    const plan = analyzeCapacity(d).nodes.caller;
    expect(plan.capacity).toBeCloseTo(4000 / 300);
    if (stencil === "generic.service") expect(plan.resourcePlan?.initialCapacity).toBeCloseTo(plan.capacity);
  },
);

it("does not subtract broker-held calls from queued pushed requests", () => {
  const d = waitingFixture();
  d.nodes[0].stencil = "generic.queue";
  const worker = cloudFixture("app-service").nodes[1];
  d.nodes[1].stencil = worker.stencil;
  d.nodes[1].props = {
    ...worker.props,
    concurrency: 4,
    latencyMs: 10,
    jitter: 0,
    resources: { ...resourceLesson(), modelRevision: "a2", cpuMsPerMessage: 1 },
  };
  d.nodes[2].props = { ...d.nodes[2].props, status: "paused" };
  let waiting = 0;
  const e = createEngine({
    verifyResources(state) {
      for (const node of state.nodes) if (node.id === "caller") waiting = node.fleet?.samples.at(-1)?.waiting ?? 0;
    },
  });
  e.load(d);
  e.inject("source", 4);
  e.step(100);
  expect(e.snapshot().nodes.caller.threads?.waiting).toBe(4);
  e.inject("caller", 2);
  e.step(1000);
  expect(e.snapshot().nodes.caller.threads?.queued).toBe(2);
  expect(waiting).toBeGreaterThan(1);
});

it.each(["azure.functions", "aws.lambda"])("reports the effective fixed execution pool (%s)", (stencil) => {
  const d = waitingFixture();
  d.nodes[1].stencil = stencil;
  Object.assign(d.nodes[1].props!, { scaling: "fixed", maxConcurrency: 1000 });
  const e = createEngine();
  e.load(d);
  e.inject("source", 4);
  e.step(40);
  expect(realSnapshot(e.snapshot()).nodes.caller.threads).toMatchObject({ slots: 4, waiting: 4 });
});

it("counts held requests in request scaler pressure, keeping CPU at executing work", () => {
  const d = waitingFixture();
  const worker = cloudFixture("cloud-run").nodes[1];
  d.nodes[1].stencil = worker.stencil;
  d.nodes[1].props = { ...worker.props, concurrency: 4, latencyMs: 10, jitter: 0 };
  const a = d.nodes[1].props!.autoscaling as { controller: { evaluationMs: number; concurrencyWindowsMs: number[] } };
  Object.assign(a.controller, { evaluationMs: 1000, minReplicas: 1, initialReplicas: 1, maxReplicas: 4 });
  d.nodes[1].props!.resources = {
    ...resourceLesson(),
    modelRevision: "a2",
    cpuMsPerMessage: 1,
    startup: { delayMs: 0, jitterFraction: 0 },
  };
  a.controller.concurrencyWindowsMs = [1000, 1000];
  d.nodes[2].props = { ...d.nodes[2].props, status: "paused" };
  const e = createEngine();
  e.load(d);
  e.inject("source", 5);
  e.step(1100);
  expect(e.snapshot().nodes.caller.threads?.waiting).toBeGreaterThanOrEqual(4);
  expect(e.fleet("caller")?.desired).toBeGreaterThan(1);
  expect(e.snapshot().nodes.caller.resources?.executedCpuMs).toBeLessThan(100);
});

it.each(["constructor", "toString", "__proto__"])("uses own emits mappings for %s", (type) => {
  const d = waitingFixture();
  d.nodes[1].props!.emits = { "*": "Done" };
  const e = createEngine();
  e.load(d);
  e.inject("source", 1, { type });
  e.step(1000);
  expect(e.snapshot().nodes.result.processed).toBe(1);
  expect(e.snapshot().events.some((event) => event.text.includes("Done"))).toBe(true);
});

it("aggregates invisible echoes and keeps drained checkpoints small", () => {
  const d = waitingFixture();
  d.nodes[1].props!.concurrency = 4000;
  d.nodes[2].props = { latencyMs: 0, api: { latencyMs: 0 }, jitter: 0 };
  d.edges = d.edges.filter((edge) => edge.id !== "call");
  for (let i = 0; i < 16; i++)
    d.edges.push({ id: `call-${i}`, from: "caller", to: "partner", kind: "sync", props: { travelMs: 10_000 } });
  const e = createEngine({ maxParticles: 0 });
  e.load(d);
  e.inject("source", 4000);
  e.step(100);
  expect(e.snapshot().inSystem).toBe(0);
  expect(e.snapshot().edges["call-0"].active).toBe(8000);
  const clone = vi.spyOn(globalThis, "structuredClone");
  const checkpoint = e.checkpoint();
  const graph = clone.mock.calls[0][0] as { trips: unknown[]; echoExpiries: unknown[]; calls: Map<number, unknown> };
  expect(graph.trips).toHaveLength(0);
  expect(graph.echoExpiries.length).toBeLessThanOrEqual(4);
  expect(graph.calls.size).toBe(0);
  clone.mockRestore();
  e.step(21_000);
  expect(e.snapshot().edges["call-0"].active).toBe(0);
  e.restore(checkpoint);
  expect(e.snapshot().edges["call-0"].active).toBe(8000);
  e.step(21_000);
  expect(e.snapshot().edges["call-0"].active).toBe(0);
});

it("sampled callers preserve non-divisible pool capacity", () => {
  const check = (capacity: number, scale: number) => {
    const d = waitingFixture();
    d.nodes[1].props!.concurrency = capacity;
    const run = (weight: number) => {
      const e = createEngine({ scale: weight, maxParticles: 0 });
      e.load(d);
      e.inject("source", 1000);
      for (let i = 0; i < 1000; i++) {
        e.step(10);
        const t = realSnapshot(e.snapshot()).nodes.caller.threads!;
        expect(t.working + t.waiting).toBeLessThanOrEqual(capacity + 1e-9);
      }
      return realSnapshot(e.snapshot()).nodes.caller.processed;
    };
    expect(run(scale)).toBeCloseTo(run(1));
  };
  check(3, 2);
  check(1, 10);
  fc.assert(fc.property(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 20 }), check), {
    numRuns: propertyRuns(30),
  });
});

it("uses the effective sampling weight for saved and manual real-count injections", () => {
  const d = waitingFixture();
  d.nodes[1].props!.concurrency = 3;
  const run = createSimulationRun(d, {
    id: "run",
    title: "Run",
    scale: 2,
    durationMs: 3000,
    traffic: [{ id: "burst", node: "source", shape: { kind: "burst", count: 12 } }],
  });
  run.inject("source", 12);
  run.step(3000);
  expect(run.units.realSnapshot().nodes.caller.processed).toBe(24);
});

it.each([
  { stencil: "generic.service", replicas: 1000, concurrency: 1, scaling: "fixed" },
  { stencil: "aws.lambda", replicas: 1, concurrency: 1, scaling: "auto" },
])("fits sampling to the total effective caller pool ($stencil)", (props) => {
  const d = waitingFixture();
  d.nodes[0].props!.ratePerSec = 200_000;
  const { stencil, ...pool } = props;
  d.nodes[1].stencil = stencil;
  Object.assign(d.nodes[1].props!, pool, { maxConcurrency: 1000 });
  const e = createEngine({ scale: 100 });
  e.load(d);
  expect(e.snapshot().scale).toBe(100);
  expect(e.trafficLimit()).toBeUndefined();
  expect(realSnapshot(e.snapshot()).nodes.caller.threads?.slots).toBe(1000);
});

it("fits a non-divisible per-replica limit to its divisible total pool", () => {
  const d = waitingFixture();
  Object.assign(d.nodes[1].props!, { replicas: 2, concurrency: 3 });
  const e = createEngine({ scale: 2 });
  e.load(d);
  expect(e.snapshot().scale).toBe(2);
});

it("keeps a caller at zero replicas able to admit its first sampled request", () => {
  const d = waitingFixture();
  const worker = cloudFixture("cloud-run").nodes[1];
  d.nodes[1].stencil = worker.stencil;
  d.nodes[1].props = {
    ...worker.props,
    concurrency: 4,
    latencyMs: 10,
    jitter: 0,
    resources: {
      ...resourceLesson(),
      modelRevision: "a2",
      cpuMsPerMessage: 1,
      startup: { delayMs: 0, jitterFraction: 0 },
    },
  };
  const e = createEngine({ scale: 100 });
  e.load(d);
  expect(e.fleet("caller")?.ready).toBe(0);
  expect(e.snapshot().scale).toBe(4);
  e.inject("source", 1);
  e.step(2000);
  expect(e.snapshot().nodes.caller.processed).toBe(1);
});
