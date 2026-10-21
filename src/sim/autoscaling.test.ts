import * as fleets from "./autoscaling";
import { sampledParts } from "./sampledResources";
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
    const f = createFleet(1, { concurrency: 1 }),
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
    const f = createFleet(4, { concurrency: 1 }),
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
    const f = createFleet(10, { concurrency: 1 }),
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
      f = createFleet(4, { concurrency: 1 });
    c.settings.down.stabilizationMs = 0;
    expect(evaluateHpa(f, c, r, 15_000)).toMatchObject({ desired: 4, reason: "missing" });
    c.settings.metrics.push({ ...c.settings.metrics[0], windowMs: 1000 });
    const grow = createFleet(4, { concurrency: 1 });
    grow.samples.push({ at: 1000, cpu: 2000, occupancy: 0, ready: 4 });
    expect(evaluateHpa(grow, c, r, 1000).desired).toBeGreaterThan(4);
  });
  it("compacts jittered readiness before sampled CPU allocation", () => {
    const run = (n: number) => {
      const f = createFleet(1, { concurrency: 1 }),
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
    const f = createFleet(1, { concurrency: 1 });
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
    const f = createFleet(2, { concurrency: 1 }),
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
  it("idle tick work is independent of replica count", () => {
    const original = fleets.createFleet;
    const run = (n: number) => {
      let visits = 0;
      const spy = vi.spyOn(fleets, "createFleet").mockImplementation((...args) => {
        const f = original(...args);
        // Previously used, now idle identities expose any traversal in stepping or frame readouts.
        for (let i = 0; i < n; i++) fleets.acquireReplica(f, 1);
        for (const id of f.busy.keys()) fleets.releaseReplica(f, id, 1);
        const wrap = <T>(items: MapIterator<T>): MapIterator<T> => {
          const next = items.next.bind(items);
          items.next = () => {
            const item = next();
            if (!item.done) visits++;
            return item;
          };
          return items;
        };
        const values = f.busy.values.bind(f.busy),
          entries = f.busy.entries.bind(f.busy);
        f.busy.values = () => wrap(values());
        f.busy[Symbol.iterator] = () => wrap(entries());
        for (const key of ["ranges", "starts", "free", "busyIds"] as const) {
          Reflect.set(
            f,
            key,
            new Proxy(f[key], {
              get(target, key, receiver) {
                if (typeof key === "string" && /^\d+$/.test(key)) visits++;
                return Reflect.get(target, key, receiver) as unknown;
              },
            }),
          );
        }
        return new Proxy(f, {
          get(target, key, receiver) {
            visits++;
            return Reflect.get(target, key, receiver) as unknown;
          },
        });
      });
      try {
        const d = fixed(40);
        d.nodes[1].props!.replicas = n;
        const e = engine(d);
        visits = 0;
        for (let i = 0; i < 100; i++) {
          e.step(10);
          e.frame();
        }
        return visits;
      } finally {
        spy.mockRestore();
      }
    };
    const small = run(1250),
      large = run(10_000);
    expect(small).toBeGreaterThan(0);
    expect(large).toBe(small);
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
  it("capacity respects CPU without treating requests as execution ceilings", () => {
    expect(analyzeCapacity(fixed(500)).nodes.worker.capacity).toBe(2);
    expect(analyzeCapacity(fixed(500, 100)).nodes.worker.capacity).toBe(2);
  });
  it("starting replicas cannot reverse a shrink recommendation into growth", () => {
    const f = createFleet(1, { concurrency: 1 }),
      r = resourceLesson(),
      c = hpaLesson().controller;
    c.settings.metrics[0].windowMs = 1000;
    c.settings.metrics[0].target = { kind: "utilization", percentOfRequest: 20 };
    r.startup.delayMs = 60_000;
    reconcileFleet(f, 4, r, 0, 42, "worker");
    f.samples.push({ at: 1000, cpu: 200, occupancy: 0, ready: 1 });
    expect(evaluateHpa(f, c, r, 1000)).toMatchObject({ raw: 4, desired: 4 });
  });
  it("concurrency edits refresh reservations and preserve fleet ownership", () => {
    const d = fixed(100);
    Object.assign(d.nodes[1].props!, { concurrency: 1, latencyMs: 10_000 });
    const e = engine(d);
    e.inject("source", 10);
    e.step(100);
    expect(e.frame().nodes.worker.inFlight).toBe(1);
    e.setNodeProps("worker", { concurrency: 4 });
    e.step(100);
    expect(e.frame().nodes.worker.inFlight).toBe(4);
    const checkpoint = e.checkpoint();
    e.setNodeProps("worker", { concurrency: 2 });
    e.step(100);
    expect(e.frame().nodes.worker.inFlight).toBe(4);
    e.step(10_000);
    expect(e.frame().nodes.worker.inFlight).toBe(2);
    e.restore(checkpoint);
    e.step(100);
    expect(e.frame().nodes.worker.inFlight).toBe(4);
  });
  it("failed replica acquisition leaves work pending without CPU or admission", () => {
    const e = engine(fixed(500));
    const spy = vi.spyOn(fleets, "acquireReplica").mockReturnValue(undefined);
    try {
      e.inject("source", 10);
      e.step(100);
      expect(e.frame().nodes.worker).toMatchObject({ inFlight: 0, backlog: 10, resources: { executedCpuMs: 0 } });
    } finally {
      spy.mockRestore();
    }
    e.step(100);
    expect(e.frame().nodes.worker.inFlight).toBe(4);
  });
  it("enabling resources queues existing work that cannot reserve the new fleet", () => {
    const d = fixed(100);
    delete d.nodes[1].props!.resources;
    Object.assign(d.nodes[1].props!, { replicas: 4, concurrency: 1, latencyMs: 1000 });
    const e = engine(d);
    e.inject("source", 4);
    e.step(100);
    expect(e.frame().nodes.worker.inFlight).toBe(4);
    e.setNodeProps("worker", { resources: resourceLesson(), autoscaling: hpaLesson() });
    expect(e.frame().nodes.worker).toMatchObject({ inFlight: 1, backlog: 3, fleet: { ready: 1 } });
    e.step(5000);
    expect(e.frame().nodes.worker).toMatchObject({ processed: 4, inFlight: 0, backlog: 0 });
  });
  it.each([1, 10])("retained resource retries exhaust delivery limits while down at scale %s", (scale) => {
    const d = fixed(100);
    d.nodes[0].stencil = "kafka.topic";
    d.nodes[0].props = { partitions: 1, maxDeliveryCount: 3 };
    d.edges[0].kind = "async";
    Object.assign(d.nodes[1].props!, { concurrency: 1, latencyMs: 100, retry: "inplace", retryBackoffMs: 200 });
    const e = engine(d, scale);
    e.inject("source", 1);
    e.step(10);
    e.setNodeStatus("worker", "down");
    e.step(2000);
    expect(e.frame().nodes.worker).toMatchObject({ failed: 3, inFlight: 0, resources: { executedCpuMs: 0 } });
    expect(e.frame().inSystem).toBe(0);
  });
  it("exact replica CPU reflects work before the first publication", () => {
    const e = engine(fixed(500));
    e.inject("source", 1);
    for (const time of [1000, 14_000, 1000]) {
      e.step(time);
      expect(e.replicaPage("worker")[0].cpuRequestPct).toBeCloseTo(e.frame().nodes.worker.resources!.cpuRequestPct!);
    }
    expect(e.replicaPage("worker")[0].cpuRequestPct).toBe(0);
  });
  it("replica CPU keeps fifteen complete seconds while the current second is unpublished", () => {
    const e = engine(fixed(500));
    e.setTraffic(true);
    e.step(16_100);
    expect(e.replicaPage("worker")[0].cpuRequestPct).toBeCloseTo(e.frame().nodes.worker.resources!.cpuRequestPct!);
  });
  it("instant resource work releases its reservation before admitting the next attempt", () => {
    const d = fixed(0);
    Object.assign(d.nodes[1].props!, { latencyMs: 0, concurrency: 1 });
    const e = engine(d);
    e.inject("source", 10);
    e.step(100);
    expect(e.frame().nodes.worker).toMatchObject({ processed: 10, inFlight: 0, backlog: 0 });
  });
  it("hashes node identity once across jittered startup expansion", () => {
    const r = resourceLesson(),
      f = createFleet(1, { concurrency: 1 }),
      node = "x".repeat(128);
    r.startup.jitterFraction = 0.5;
    let reads = 0;
    const original = String.prototype.charCodeAt;
    const spy = vi.spyOn(String.prototype, "charCodeAt").mockImplementation(function (this: string, index) {
      if (String(this) === node) reads++;
      return original.call(this, index);
    });
    try {
      reconcileFleet(f, 1250, r, 0, 42, node);
      const first = reads;
      reconcileFleet(f, 10_000, r, 0, 42, node);
      expect(first).toBe(node.length);
      expect(reads).toBe(first);
    } finally {
      spy.mockRestore();
    }
  });
  it("sampled admissions do not rescan unchanged protected boundaries", () => {
    const f = createFleet(8, { concurrency: 1 }),
      working: Parameters<typeof sampledParts>[3] = [];
    working.push({ cpuParts: sampledParts(f, 3, 100, working) });
    let visits = 0;
    const tracked = new Proxy(working, {
      get(target, key, receiver) {
        if (typeof key === "string" && /^\d+$/.test(key)) visits++;
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    for (let i = 0; i < 800; i++) working.push({ cpuParts: sampledParts(f, 8, 100, tracked) });
    expect(visits).toBe(0);
    f.rangesDirty = true;
    fleets.compactReadyRanges(f, tracked);
    expect(visits).toBe(working.length);
    expect(f.ranges).toHaveLength(2);
  });
  it.each([false, true])("pagination expands only the requested identities (previously used: %s)", (used) => {
    const f = createFleet(10_000, { concurrency: 1 }),
      r = resourceLesson();
    if (used) {
      for (let i = 0; i < 10_000; i++) fleets.acquireReplica(f, 1);
      for (const id of f.busy.keys()) fleets.releaseReplica(f, id, 1);
    }
    let rows = 0,
      visits = 0;
    const original = Array.prototype.push;
    Array.prototype.push = function (this: unknown[], ...items: unknown[]) {
      rows += items.filter((item) => item && typeof item === "object" && "id" in item && "state" in item).length;
      return original.apply(this, items);
    };
    const entries = f.busy[Symbol.iterator].bind(f.busy);
    f.busy[Symbol.iterator] = () => {
      const it = entries(),
        next = it.next.bind(it);
      it.next = () => {
        const item = next();
        if (!item.done) visits++;
        return item;
      };
      return it;
    };
    try {
      const first = fleets.replicaPage(f, r, 1000, 1, 0);
      const last = fleets.replicaPage(f, r, 1000, 1, 199);
      expect(first.map((p) => p.id)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
      expect(last.map((p) => p.id)).toEqual(Array.from({ length: 50 }, (_, i) => i + 9951));
      expect(rows).toBeLessThanOrEqual(100);
      expect(visits).toBe(0);
    } finally {
      Array.prototype.push = original;
    }
  });
  it("draining readouts do not visit previously used replicas", () => {
    const f = createFleet(10_000, { concurrency: 1 }),
      r = resourceLesson();
    for (let i = 0; i < 10_000; i++) fleets.acquireReplica(f, 1);
    for (const id of f.busy.keys()) fleets.releaseReplica(f, id, 1);
    const values = vi.spyOn(f.busy, "values");
    expect(fleets.fleetReadout(f).draining).toBe(0);
    expect(fleets.resourceReadout(f, r, 0, 1000, 1).memoryMiB).toBe(r.baselineMemoryMiB);
    expect(values).not.toHaveBeenCalled();
  });
});

describe("round 3 runtime regressions", () => {
  it("applies saved HPA policy and capacity atomically after time has advanced", () => {
    const e = engine();
    e.setCapacityMultiplier(2);
    e.step(1000);
    const before = e.frame().nodes.worker.fleet!;
    const a = hpaLesson();
    Object.assign(a.controller, { minReplicas: 2, initialReplicas: 2, maxReplicas: 20 });
    e.setNodePropsBatch({ worker: { autoscaling: a } }, 1);
    expect(e.frame().nodes.worker.fleet).toMatchObject({ desired: before.desired, ready: before.ready, starting: 0 });
  });
  it.each([false, true])("freezes startup through pause and restore (created while paused: %s)", (duringPause) => {
    const e = engine();
    e.step(10);
    if (!duringPause) e.setNodeProps("worker", { replicas: 2 });
    e.step(1000);
    e.setNodeStatus("worker", "paused");
    e.step(3000);
    if (duringPause) e.setNodeProps("worker", { replicas: 2 });
    e.step(7000);
    const checkpoint = e.checkpoint();
    const resume = () => {
      e.setNodeStatus("worker", "up");
      e.step(duringPause ? 4990 : 3990);
      expect(e.frame().nodes.worker.fleet).toMatchObject({ ready: 1, starting: 1 });
      e.step(10);
      expect(e.frame().nodes.worker.fleet).toMatchObject({ ready: 2, starting: 0 });
    };
    resume();
    e.restore(checkpoint);
    resume();
  });
  it.each([1, 10])("freezes draining grace at scale %s", (scale) => {
    const run = (pause: boolean) => {
      const d = fixed(0);
      Object.assign(d.nodes[1].props!, { replicas: 2, concurrency: 1 });
      (d.nodes[1].props!.resources as ReturnType<typeof resourceLesson>).terminationGraceMs = 500;
      const e = engine(d, scale);
      e.inject("source", 2);
      e.step(scale === 1 ? 20 : 1260);
      e.setNodeProps("worker", { replicas: 1 });
      expect(e.frame().nodes.worker.fleet!.draining).toBeGreaterThan(0);
      if (pause) {
        e.setNodeStatus("worker", "paused");
        e.step(10_000);
        e.setNodeStatus("worker", "up");
      }
      e.step(3000);
      const { processed, failed, dropped, fleet } = e.frame().nodes.worker;
      return { processed, failed, dropped, draining: fleet!.draining };
    };
    const baseline = run(false);
    expect(baseline.failed).toBe(0);
    expect(run(true)).toEqual(baseline);
  });
  it("preflights a whole live override batch before allocating any startup cohorts", () => {
    const d = fixed(40),
      worker = d.nodes[1];
    d.nodes = Array.from({ length: 11 }, (_, i) => ({ ...structuredClone(worker), id: `worker-${i}` }));
    d.edges = [];
    for (const n of d.nodes) (n.props!.resources as ReturnType<typeof resourceLesson>).startup.jitterFraction = 0.5;
    const e = engine(d);
    e.step(100);
    const before = e.snapshot(),
      configuration = e.effectiveProps("worker-0");
    expect(() => e.setNodePropsBatch(Object.fromEntries(d.nodes.map((n) => [n.id, { replicas: 10_000 }])), 2)).toThrow(
      /100/,
    );
    expect(e.snapshot()).toEqual(before);
    expect(e.effectiveProps("worker-0")).toEqual(configuration);
  });
  it("indexes jittered starting cohorts before paginating, including after readiness and cancellation", () => {
    const f = createFleet(1, { concurrency: 1 }),
      r = resourceLesson();
    r.startup.jitterFraction = 0.5;
    reconcileFleet(f, 10_000, r, 0, 42, "worker");
    const check = () => {
      // The selected inspector pays one rebuild per lifecycle batch; subsequent pages use the index.
      fleets.replicaPage(f, r, 0, 1, 100);
      const expected = [...f.ranges.slice(f.rangeHead), ...f.starts]
        .flatMap((c) => Array.from({ length: c.last - c.first + 1 }, (_, i) => c.first + i))
        .sort((a, b) => a - b)
        .slice(5000, 5050);
      let reads = 0;
      const starts = f.starts,
        ranges = f.ranges,
        index = f.replicaIndex;
      const track = <T extends object>(array: T[]) =>
        new Proxy(array, {
          get(target, key, receiver) {
            if (typeof key === "string" && /^\d+$/.test(key)) reads++;
            return Reflect.get(target, key, receiver) as unknown;
          },
        });
      f.starts = track(starts);
      f.ranges = track(ranges);
      f.replicaIndex = track(index);
      try {
        const rows = fleets.replicaPage(f, r, 0, 1, 100);
        expect(rows.map((row) => row.id)).toEqual(expected);
        // Only a page's intervals, irrespective of thousands of ready/starting cohorts.
        expect(reads).toBeLessThanOrEqual(50);
      } finally {
        f.starts = starts;
        f.ranges = ranges;
        f.replicaIndex = index;
      }
    };
    check();
    advanceFleet(f, 5000);
    check();
    reconcileFleet(f, 6000, r, 5000, 42, "worker");
    check();
  });
  it.each([1, 10])("memory recommendation wins over low CPU at scale %s", (scale) => {
    const f = createFleet(4, { concurrency: 1 }),
      c = hpaLesson().controller,
      r = resourceLesson();
    r.baselineMemoryMiB = 128;
    r.memoryRequestMiB = 256;
    r.memoryMiBPerMessage = 32;
    c.settings.metrics[0].windowMs = 1000;
    c.settings.metrics.push({
      ...structuredClone(c.settings.metrics[0]),
      source: { kind: "resource", resource: "memory" },
      target: { kind: "utilization", percentOfRequest: 50 },
    });
    chargeCpu(f, undefined, 100);
    integrateResources(f, 4, 15_000, 15_000);
    expect(evaluateHpa(f, c, r, 15_000, 1, scale)).toMatchObject({
      metric: 62.5,
      raw: 5,
      desired: 5,
      resource: "memory",
    });
  });
  it("absolute CPU target works without a CPU request", () => {
    const f = createFleet(4, { concurrency: 1 }),
      c = hpaLesson().controller,
      r = resourceLesson();
    delete r.cpuRequestMilli;
    c.settings.metrics[0].target = { kind: "averageValue", value: 250 };
    c.settings.metrics[0].windowMs = 1000;
    f.samples.push({ at: 15_000, cpu: 2000, occupancy: 0, ready: 4 });
    expect(evaluateHpa(f, c, r, 15_000)).toMatchObject({
      metric: 500,
      raw: 8,
      desired: 8,
      resource: "cpu",
      targetKind: "averageValue",
    });
  });
});
