import * as fleets from "./autoscaling";
import { sampledParts } from "./sampledResources";
import { growth, LINEAR_LIMIT } from "../test/complexity";
import { describe, it, expect, vi } from "vitest";
import { createEngine } from "./engine";
import { createFleet, advanceFleet, evaluateHpa, reconcileFleet, chargeCpu, integrateResources } from "./autoscaling";
import { hpaLesson, resourceLesson } from "../model/autoscaling";
import { autoscalingFixture } from "../lab/autoscalingFixture";
import { analyzeCapacity } from "./capacity";

const engine = (d = autoscalingFixture(), scale = 1) => {
  const e = createEngine({ seed: 42, scale });
  e.load(d);
  return e;
};
const fixed = (cost: number, request = 500, limit = 1000) => {
  const d = autoscalingFixture();
  d.nodes[1].props = {
    ...d.nodes[1].props,
    autoscaling: { mode: "off" },
    resources: { ...resourceLesson(), cpuMsPerMessage: cost, cpuRequestMilli: request, cpuLimitMilli: limit },
  };
  return d;
};
describe("A1 CPU and fleet execution", () => {
  it("integrates known CPU work, throttles at limits, and requests only change the denominator", () => {
    const run = (cost: number, request = 500, limit = 1000) => {
      const e = engine(fixed(cost, request, limit));
      e.inject("source", 100);
      e.step(10_000);
      return e.snapshot().nodes.worker;
    };
    const io = run(40),
      cpu = run(500),
      denominator = run(40, 1000),
      throttled = run(500, 500, 500);
    expect(io.processed).toBe(100);
    expect(io.resources!.executedCpuMs).toBeCloseTo(4000);
    expect(cpu.processed).toBeLessThan(io.processed);
    expect(throttled.processed).toBeLessThan(cpu.processed);
    expect(denominator.processed).toBe(io.processed);
    expect(denominator.resources!.cpuRequestPct).toBeCloseTo(io.resources!.cpuRequestPct! / 2);
  });
  it("bursts scale deterministically at sync, gate startup, build backlog then drain", () => {
    const e = engine();
    e.setTraffic(true);
    e.step(15_000);
    const first = e.snapshot().nodes.worker;
    expect(first.fleet!.decision!.raw).toBe(2);
    expect(first.fleet).toMatchObject({ desired: 2, ready: 1, starting: 1 });
    expect(first.backlog).toBeGreaterThan(0);
    e.step(4990);
    expect(e.snapshot().nodes.worker.fleet!.ready).toBe(1);
    const checkpoint = e.checkpoint();
    e.step(10);
    expect(e.snapshot().nodes.worker.fleet!.ready).toBe(2);
    e.step(60_000);
    const full = e.snapshot();
    e.restore(checkpoint);
    e.setSpeed(4);
    e.step(60_010 / 4);
    expect(e.snapshot()).toEqual(full);
    e.setTraffic(false);
    e.step(100_000 / 4);
    expect(e.snapshot().nodes.worker.backlog).toBe(0);
    expect(e.snapshot().inSystem).toBe(0);
  });
  it.each([1, 2, 5, 10, 100])("keeps a CPU burst observable at sampled scale %s", (scale) => {
    const e = engine(autoscalingFixture(), scale);
    e.setTraffic(true);
    e.step(15_000);
    expect(e.snapshot().nodes.worker.fleet!.decision).toMatchObject({ raw: 2, desired: 2 });
  });
  it("uses the published +4/+100% growth policies rather than jumping to target", () => {
    const f = createFleet(1),
      c = hpaLesson().controller,
      r = resourceLesson();
    c.settings.metrics[0].target = { kind: "utilization", percentOfRequest: 10 };
    for (let t = 1000; t <= 15_000; t += 1000) {
      chargeCpu(f, undefined, 1000);
      integrateResources(f, 4, t, 1000);
    }
    expect(evaluateHpa(f, c, r, 15_000)).toMatchObject({ raw: 20, desired: 5, reason: "max" });
  });
  it("retains the rolling maximum for 300 simulated seconds, then shrinks at the first eligible sync", () => {
    const f = createFleet(4),
      c = hpaLesson().controller,
      r = resourceLesson();
    c.settings.metrics[0].windowMs = 1000;
    f.samples.push({ at: 15_000, cpu: 1400, occupancy: 0, ready: 4 });
    expect(evaluateHpa(f, c, r, 15_000).desired).toBe(4);
    for (let t = 30_000; t <= 315_000; t += 15_000) {
      f.samples.push({ at: t, cpu: 0, occupancy: 0, ready: 4 });
      expect(evaluateHpa(f, c, r, t).desired).toBe(4);
    }
    f.samples.push({ at: 330_000, cpu: 0, occupancy: 0, ready: 4 });
    expect(evaluateHpa(f, c, r, 330_000).desired).toBe(1);
  });
  it("reports max 10 wanting 14 at 92% CPU and handles missing metrics/tolerance safely", () => {
    const f = createFleet(10),
      c = hpaLesson().controller,
      r = resourceLesson();
    c.settings.metrics[0].windowMs = 1000;
    f.samples.push({ at: 15_000, cpu: 4600, occupancy: 0, ready: 10 });
    expect(evaluateHpa(f, c, r, 15_000)).toMatchObject({ raw: 14, desired: 10, reason: "max", metric: 92 });
    f.samples = [];
    expect(evaluateHpa(f, c, r, 30_000).desired).toBe(10);
    f.samples.push({ at: 45_000, cpu: 3500, occupancy: 0, ready: 10 });
    expect(evaluateHpa(f, c, r, 45_000)).toMatchObject({ desired: 10, reason: "tolerance" });
  });
  it("sampled cohorts retain occupied IDs and CPU through drain, including checkpoint and grace", () => {
    const d = fixed(40);
    d.nodes[1].props!.replicas = 8;
    d.nodes[1].props!.latencyMs = 1000;
    const r = d.nodes[1].props!.resources as ReturnType<typeof resourceLesson>;
    r.terminationGraceMs = 100;
    const e = engine(d, 100);
    e.inject("source", 1);
    e.step(3130);
    e.setNodeProps("worker", { replicas: 4 });
    expect(e.snapshot().nodes.worker.fleet).toMatchObject({ ready: 4, draining: 4 });
    const checkpoint = e.checkpoint();
    e.step(100);
    const after = e.snapshot();
    expect(after.nodes.worker.fleet!.draining).toBe(0);
    expect(after.nodes.worker.failed).toBe(1);
    e.restore(checkpoint);
    e.step(100);
    expect(e.snapshot()).toEqual(after);
    e.step(20_000);
    expect(e.snapshot().nodes.worker.failed).toBe(1);
  });
  it("lets sampled draining cohorts finish with their CPU instead of stealing ready CPU", () => {
    const d = fixed(200);
    d.nodes[1].props!.replicas = 8;
    d.nodes[1].props!.latencyMs = 250;
    const e = engine(d, 100);
    e.inject("source", 1);
    e.step(790);
    e.setNodeProps("worker", { replicas: 4 });
    e.step(3000);
    const s = e.snapshot().nodes.worker;
    expect(s.processed).toBe(1);
    expect(s.failed).toBe(0);
    expect(s.resources!.executedCpuMs).toBeCloseTo(20_000);
    expect(s.fleet).toMatchObject({ ready: 4, draining: 0 });
  });
  it("matches max-reached planning with playback, then improves only after replacement readiness", () => {
    const d = autoscalingFixture();
    d.nodes[0].props!.ratePerSec = 115;
    expect(analyzeCapacity(d).nodes.worker.resourcePlan!.targetReplicas).toBe(14);
    const e = engine(d);
    e.setTraffic(true);
    e.step(180_000);
    const before = e.snapshot().nodes.worker;
    expect(before.fleet).toMatchObject({ desired: 10, ready: 10, decision: { raw: 14, reason: "max" } });
    expect(before.resources!.cpuRequestPct).toBeCloseTo(92, 0);
    const a = hpaLesson();
    a.controller.maxReplicas = 14;
    e.setNodeProps("worker", { autoscaling: a });
    e.step(15_000);
    expect(e.snapshot().nodes.worker.fleet).toMatchObject({ ready: 10, starting: 4 });
    e.step(4990);
    expect(e.snapshot().nodes.worker.fleet!.ready).toBe(10);
    e.step(10);
    expect(e.snapshot().nodes.worker.fleet!.ready).toBe(14);
    e.step(60_000);
    expect(e.snapshot().nodes.worker.resources!.cpuRequestPct).toBeLessThan(75);
  });
  it("keeps missing metrics safe without stabilization, while a valid metric can grow", () => {
    const c = hpaLesson().controller,
      r = resourceLesson(),
      f = createFleet(4);
    c.settings.down.stabilizationMs = 0;
    expect(evaluateHpa(f, c, r, 15_000)).toMatchObject({ desired: 4, reason: "missing" });
    c.settings.metrics.push({ ...c.settings.metrics[0], windowMs: 1000 });
    const grow = createFleet(4);
    grow.samples.push({ at: 1000, cpu: 2000, occupancy: 0, ready: 4 });
    expect(evaluateHpa(grow, c, r, 1000).desired).toBeGreaterThan(4);
  });
  it("compacts jittered readiness before sampled CPU allocation", () => {
    const run = (n: number) => {
      const f = createFleet(1),
        r = resourceLesson();
      r.startup.jitterFraction = 0.5;
      reconcileFleet(f, n, r, 0, 42, "worker");
      advanceFleet(f, 10_000);
      expect(f.ranges).toHaveLength(1);
      return sampledParts(f, n, n * 40, []);
    };
    expect(run(1250)).toHaveLength(1);
    expect(run(10_000)).toHaveLength(1);
  });
  it("caches detached immutable history between publications", () => {
    const f = createFleet(1);
    integrateResources(f, 0, 1000, 1000);
    const a = fleets.fleetReadout(f),
      b = fleets.fleetReadout(f);
    expect(b.history).toBe(a.history);
    expect(Object.isFrozen(a.history)).toBe(true);
    expect(Object.isFrozen(a.history[0])).toBe(true);
    integrateResources(f, 0, 2000, 1000);
    expect(fleets.fleetReadout(f).history).not.toBe(a.history);
    expect(a.history).toHaveLength(1);
  });
  it("retains the largest permitted metric window plus delay", () => {
    const f = createFleet(2),
      c = hpaLesson().controller,
      r = resourceLesson();
    c.settings.metrics[0].windowMs = 1000;
    c.settings.metrics[0].metricDelayMs = 599_000;
    for (let t = 1000; t <= 602_000; t += 1000) {
      chargeCpu(f, undefined, 2000);
      integrateResources(f, 0, t, 1000);
    }
    expect(evaluateHpa(f, c, r, 602_000)).toMatchObject({ raw: 6, metric: 200 });
  });
  it("bounds effective fixed replica counts before jitter expansion", () => {
    const d = fixed(40);
    const r = d.nodes[1].props!.resources as ReturnType<typeof resourceLesson>;
    r.startup.jitterFraction = 0.5;
    const e = engine(d);
    e.setCapacityMultiplier(100);
    e.setNodeProps("worker", { replicas: 10_000 });
    expect(e.frame().nodes.worker.fleet!.desired).toBe(10_000);
    e.step(10_000);
    expect(e.frame().nodes.worker.fleet!.ready).toBe(10_000);
    d.nodes[1].props!.replicas = 10_000;
    expect(
      analyzeCapacity(d, { id: "cap", title: "Cap", durationMs: 1000, traffic: [], multipliers: { capacity: 100 } })
        .nodes.worker.replicas,
    ).toBe(10_000);
  });
  it("gates sampled broker CPU by its partition assignment even with an idle HTTP input", () => {
    const d = fixed(500);
    d.nodes[1].props!.replicas = 8;
    d.nodes[0].stencil = "kafka.topic";
    d.nodes[0].props = { partitions: 3 };
    d.edges[0].kind = "async";
    d.nodes.push({ id: "http", stencil: "client.browser", label: "HTTP", x: 0, y: 0 });
    d.edges.push({ id: "http-call", from: "http", to: "worker", kind: "sync", props: { travelMs: 10 } });
    const run = (scale: number) => {
      const e = engine(d, scale);
      e.inject("source", 1000 / scale);
      e.step(90_000);
      return e.frame().nodes.worker.processed * scale;
    };
    expect(Math.abs(run(1) - run(10))).toBeLessThan(20);
  });
  it("clears draining partition reservations when resources are removed", () => {
    const d = fixed(40);
    d.nodes[0].stencil = "kafka.topic";
    d.nodes[0].props = { partitions: 2 };
    d.edges[0].kind = "async";
    Object.assign(d.nodes[1].props!, { replicas: 2, concurrency: 1, latencyMs: 10_000 });
    const e = engine(d);
    e.inject("source", 20);
    e.step(30);
    e.setNodeProps("worker", { replicas: 1 });
    expect(e.frame().nodes.worker.fleet!.draining).toBe(1);
    e.setNodeProps("worker", { resources: undefined, replicas: 2 });
    e.step(20_000);
    expect(e.frame().nodes.worker.activeReplicas).toBe(2);
  });
  it.each([1, 10])("retained down-arrival retries own resource capacity at scale %s", (scale) => {
    const d = fixed(100);
    d.nodes[0].stencil = "kafka.topic";
    d.nodes[0].props = { partitions: 2, maxDeliveryCount: 5 };
    d.edges[0].kind = "async";
    d.edges[0].props = { travelMs: 100 };
    Object.assign(d.nodes[1].props!, {
      replicas: 2,
      concurrency: 1,
      latencyMs: 1000,
      retry: "inplace",
      retryBackoffMs: 0,
    });
    const e = engine(d, scale);
    e.inject("source", 10);
    e.step(10);
    e.setNodeStatus("worker", "down");
    e.step(200);
    e.setNodeStatus("worker", "up");
    e.setNodeProps("worker", { replicas: 1 });
    const before = e.frame().nodes.worker.resources!.executedCpuMs;
    e.step(100);
    expect(e.frame().nodes.worker.resources!.executedCpuMs - before).toBeLessThanOrEqual(200); // ready + one draining replica
    expect(e.frame().nodes.worker.fleet!.draining).toBeGreaterThan(0);
  });
  it("idle engine ticks and frames avoid per-replica reads", () => {
    const original = fleets.createFleet;
    const run = (n: number) => {
      let reads = 0;
      const spy = vi.spyOn(fleets, "createFleet").mockImplementation(
        (...args) =>
          new Proxy(original(...args), {
            get(target, key, receiver) {
              if (key === "ready") reads++;
              return Reflect.get(target, key, receiver) as unknown;
            },
          }),
      );
      try {
        const d = fixed(40);
        d.nodes[1].props!.replicas = n;
        const e = engine(d);
        reads = 0;
        for (let i = 0; i < 100; i++) {
          e.step(10);
          e.frame();
        }
        return reads;
      } finally {
        spy.mockRestore();
      }
    };
    expect(run(10_000)).toBe(run(1250));
    const make = (n: number) => {
      const d = fixed(40);
      d.nodes[1].props!.replicas = n;
      const e = engine(d);
      e.step(1_200_000);
      return () => {
        e.step(10);
        e.frame();
      };
    };
    expect(growth(make(1250), make(10_000))).toBeLessThan(LINEAR_LIMIT);
  });
  it("counts idle partition readers without giving a log more assigned work", () => {
    const d = autoscalingFixture();
    d.nodes[0].stencil = "kafka.topic";
    d.edges[0].kind = "async";
    d.nodes[0].props = { partitions: 3 };
    const a = hpaLesson();
    Object.assign(a.controller, { initialReplicas: 8, minReplicas: 8 });
    d.nodes[1].props!.autoscaling = a;
    const e = engine(d);
    e.inject("source", 300);
    e.step(1000);
    expect(e.snapshot().nodes.worker).toMatchObject({ replicas: 8, activeReplicas: 3, idleReplicas: 5 });
    expect(e.snapshot().nodes.worker.inFlight).toBeLessThanOrEqual(12);
  });
  it("spare ready replicas serve HTTP while the same node's log input remains partition-gated", () => {
    const d = autoscalingFixture();
    d.nodes[0].stencil = "kafka.topic";
    d.edges[0].kind = "async";
    d.nodes[0].props = { partitions: 3 };
    const a = hpaLesson();
    Object.assign(a.controller, { initialReplicas: 8, minReplicas: 8 });
    d.nodes[1].props!.autoscaling = a;
    d.nodes.push({ id: "http", stencil: "client.browser", label: "HTTP", x: 0, y: 0 });
    d.edges.push({ id: "http-call", from: "http", to: "worker", kind: "sync", props: { travelMs: 10 } });
    const e = engine(d);
    e.inject("source", 300);
    e.step(1000);
    expect(e.frame().nodes.worker.inFlight).toBeLessThanOrEqual(12);
    e.inject("http", 100);
    e.step(50);
    expect(e.frame().nodes.worker).toMatchObject({ replicas: 8, activeReplicas: 8 });
    expect(e.frame().nodes.worker.inFlight).toBeGreaterThan(12);
  });
  it("drains running identities without new admission; grace expiry fails each attempt once", () => {
    const d = fixed(40);
    d.nodes[1].props!.replicas = 2;
    d.nodes[1].props!.concurrency = 1;
    d.nodes[1].props!.latencyMs = 10_000;
    const r = d.nodes[1].props!.resources as ReturnType<typeof resourceLesson>;
    r.terminationGraceMs = 100;
    const e = engine(d);
    e.inject("source", 4);
    e.step(30);
    e.setNodeProps("worker", { replicas: 1 });
    expect(e.snapshot().nodes.worker.fleet).toMatchObject({ ready: 1, draining: 1 });
    e.step(100);
    expect(e.snapshot().nodes.worker.failed).toBe(1);
    expect(e.snapshot().nodes.worker.fleet!.draining).toBe(0);
    e.step(10_000);
    expect(e.snapshot().nodes.worker.failed).toBe(1);
  });
  it("reports idle baseline/active memory risk without adding an OOM admission policy", () => {
    const d = fixed(40);
    const r = d.nodes[1].props!.resources as ReturnType<typeof resourceLesson>;
    r.memoryLimitMiB = 129;
    const e = engine(d);
    e.inject("source", 4);
    e.step(100);
    expect(e.snapshot().nodes.worker.resources).toMatchObject({ memoryMiB: 136, unsafe: true });
    e.step(1000);
    expect(e.snapshot().nodes.worker.processed).toBe(4);
  });
  it("sampling charges CPU once and integrates occupancy rather than inventing memory for a giant dot", () => {
    const d = fixed(40);
    d.nodes[1].props!.replicas = 8;
    d.nodes[0].props!.ratePerSec = 160;
    const exact = engine(d),
      sampled = engine(d, 100);
    exact.setTraffic(true);
    sampled.setTraffic(true);
    exact.step(90_000);
    sampled.step(90_000);
    const a = exact.frame().nodes.worker,
      b = sampled.frame().nodes.worker;
    expect(Math.abs(a.processed - b.processed * 100)).toBeLessThan(200);
    expect(b.resources!.executedCpuMs / a.resources!.executedCpuMs).toBeGreaterThan(0.95);
    expect(b.resources!.executedCpuMs / a.resources!.executedCpuMs).toBeLessThan(1.05);
    expect(b.resources!.memoryMiB).toBeLessThanOrEqual(136);
    expect(b.resources!.memoryMiB).toBeGreaterThan(128);
    expect(b.resources!.unsafe).toBe(false);
    expect(sampled.replicaPage("worker").every((r) => r.estimated)).toBe(true);
  });
  it("a graceful drain finishes existing work and admits new work only on ready identities", () => {
    const d = fixed(40);
    d.nodes[1].props!.replicas = 2;
    d.nodes[1].props!.concurrency = 1;
    d.nodes[1].props!.latencyMs = 1000;
    const e = engine(d);
    e.inject("source", 6);
    e.step(30);
    e.setNodeProps("worker", { replicas: 1 });
    expect(e.frame().nodes.worker.fleet!.draining).toBe(1);
    e.step(1000);
    expect(e.frame().nodes.worker.fleet!.draining).toBe(0);
    e.step(6000);
    expect(e.frame().nodes.worker).toMatchObject({ failed: 0, dropped: 0, processed: 6 });
    expect(e.frame().inSystem).toBe(0);
  });
  it("pauses controllers without replaying missed evaluations and seeds startup independently of tracing", () => {
    const d = autoscalingFixture();
    const r = d.nodes[1].props!.resources as ReturnType<typeof resourceLesson>;
    r.startup.jitterFraction = 0.5;
    const a = engine(d),
      b = engine(d);
    b.tracer.setHistory(50);
    for (const e of [a, b]) {
      e.setTraffic(true);
      e.step(15_000);
      e.setNodeStatus("worker", "paused");
      e.step(60_000);
    }
    expect(a.frame().nodes.worker.fleet!.decision!.at).toBe(15_000);
    for (const e of [a, b]) {
      e.setNodeStatus("worker", "up");
      e.step(14_990);
    }
    expect(a.frame().nodes.worker.fleet!.decision!.at).toBe(15_000);
    a.step(10);
    b.step(10);
    expect(a.frame()).toEqual(b.frame());
    expect(a.frame().nodes.worker.fleet!.decision!.at).toBe(90_000);
  });
  it("keeps native serverless allocation as its sole scaling owner", () => {
    const d = autoscalingFixture();
    d.nodes[1].stencil = "aws.lambda";
    const e = engine(d);
    e.setTraffic(true);
    e.step(30_000);
    expect(e.snapshot().nodes.worker.fleet).toBeUndefined();
    expect(e.snapshot().nodes.worker.rejected).toBeDefined();
  });
  it("leaves earlier planning revisions and resource-less diagrams unchanged", () => {
    for (const revision of ["p1", "p2", "p3"] as const) {
      const d = autoscalingFixture();
      d.planning!.revision = revision;
      const a = engine(d);
      a.inject("source", 100);
      a.step(30_000);
      delete d.nodes[1].props!.resources;
      delete d.nodes[1].props!.autoscaling;
      const b = engine(d);
      b.inject("source", 100);
      b.step(30_000);
      expect(a.snapshot()).toEqual(b.snapshot());
    }
  });
  it("does constant work per idle tick at 10,000 replicas (small input is one eighth)", () => {
    const run = (n: number) => {
      const f = createFleet(n);
      const r = resourceLesson();
      reconcileFleet(f, n, r, 0, 42, "worker");
      for (let t = 10; t <= 1000; t += 10) advanceFleet(f, t);
      return f;
    };
    const small = run(1250),
      large = run(10_000);
    expect(large.operations).toBe(small.operations);
    expect(large.busy.size).toBe(0);
    expect(large.ranges).toHaveLength(1);
  });
  it("capacity respects CPU without treating requests as execution ceilings", () => {
    expect(analyzeCapacity(fixed(500)).nodes.worker.capacity).toBe(2);
    expect(analyzeCapacity(fixed(500, 100)).nodes.worker.capacity).toBe(2);
  });
});
