import { expect, it, vi } from "vitest";
import { autoscalingFixture } from "../lab/autoscalingFixture";
import { hpaLesson, resourceLesson } from "../model/autoscaling";
import { createEngine } from "./engine";
import * as fleets from "./autoscaling";
import { sampledParts, releaseCpuParts, canDrainSampled } from "./sampledResources";
import { MAX_CPU_PARTS } from "./resourceWork";
import { assertResourceInvariants } from "./resourceInvariants";
import { countingReads } from "../test/complexity";

function fixed() {
  const d = autoscalingFixture();
  Object.assign(d.nodes[1].props!, {
    autoscaling: { mode: "off" },
    concurrency: 1,
    latencyMs: 100,
    resources: { ...resourceLesson(), cpuMsPerMessage: 10 },
  });
  return d;
}
function broker() {
  const d = fixed();
  d.nodes[0].stencil = "kafka.topic";
  d.nodes[0].props = { partitions: 1, maxDeliveryCount: 5 };
  d.edges[0].kind = "async";
  Object.assign(d.nodes[1].props!, { failureRate: 1, retry: "inplace", retryBackoffMs: 1000 });
  return d;
}
const load = (d = fixed(), scale = 1) => {
  const e = createEngine({ seed: 42, scale, verifyResources: assertResourceInvariants });
  e.load(d);
  return e;
};
it("retry admission refusal releases its replica and later traffic recovers", () => {
  const d = broker();
  d.nodes[1].props!.api = {
    quotas: [{ id: "q", unit: "requests", amount: 1, burst: 1, windowMs: 600_000, algorithm: "token-bucket" }],
  };
  const e = load(d);
  e.inject("source", 1);
  e.step(1200);
  expect(e.frame().nodes.worker.rejected).toBe(1);
  e.setNodeProps("worker", { api: undefined, failureRate: 0 });
  e.inject("source", 1);
  e.step(1000);
  expect(e.frame().nodes.worker.processed).toBe(1);
});
it("disabling resources clears attempts queued by fleet initialization", () => {
  const d = fixed();
  Object.assign(d.nodes[1].props!, { resources: undefined, replicas: 4, latencyMs: 1000 });
  const e = load(d);
  e.inject("source", 4);
  e.step(20);
  e.setNodeProps("worker", { replicas: 1, resources: resourceLesson() });
  e.setNodeProps("worker", { resources: undefined, replicas: 4 });
  e.step(3000);
  expect(e.frame().nodes.worker.processed).toBe(4);
  expect(e.frame().nodes.worker.inFlight).toBe(0);
});
it("integrates the final processing quantum into memory metrics", () => {
  const d = fixed(),
    a = hpaLesson();
  a.controller.settings.syncMs = 1000;
  a.controller.settings.metrics = [
    {
      source: { kind: "resource", resource: "memory" },
      target: { kind: "averageValue", value: 50 },
      windowMs: 1000,
      metricDelayMs: 0,
    },
  ];
  Object.assign(d.nodes[0].props!, { ratePerSec: 100 });
  Object.assign(d.nodes[1].props!, {
    latencyMs: 10,
    autoscaling: a,
    resources: { ...resourceLesson(), cpuMsPerMessage: 0, baselineMemoryMiB: 0, memoryMiBPerMessage: 100 },
  });
  const e = load(d);
  e.setTraffic(true);
  e.step(1000);
  expect(e.frame().nodes.worker.fleet!.decision!.metric).toBeGreaterThan(90);
  expect(e.frame().nodes.worker.fleet!.desired).toBe(2);
});
it.each([1, 10])("pause freezes retry CPU and admission backoff at scale %s", (scale) => {
  const d = broker();
  d.nodes[1].props!.api = {};
  d.nodes[1].props!.replicas = scale;
  d.nodes[0].props!.partitions = scale;
  const e = load(d, scale);
  e.inject("source", 1);
  for (let i = 0; i < 300 && !e.frame().nodes.worker.failed; i++) e.step(10);
  const before = e.frame().nodes.worker.resources!.executedCpuMs;
  expect(e.frame().nodes.worker.failed).toBe(1);
  e.setNodeStatus("worker", "paused");
  e.step(2000);
  e.setNodeStatus("worker", "up");
  e.step(100);
  expect(e.frame().nodes.worker.resources!.executedCpuMs).toBe(before);
  expect(e.frame().nodes.worker.failed).toBe(1);
});
it("percentage downscale progresses for small fleets", () => {
  const f = fleets.createFleet(3),
    r = resourceLesson(),
    c = hpaLesson().controller;
  c.settings.metrics[0].windowMs = 1000;
  c.settings.down = {
    stabilizationMs: 0,
    selectPolicy: "Max",
    policies: [{ type: "Percent", value: 10, periodMs: 15_000 }],
  };
  const evaluate = (time: number) => {
    f.samples.push({ at: time, cpu: 0, occupancy: 0, ready: f.ready });
    const result = fleets.evaluateHpa(f, c, r, time);
    fleets.reconcileFleet(f, result.desired, r, time, 42, "worker");
    return result;
  };
  expect(evaluate(1000)).toMatchObject({ raw: 1, desired: 2 });
  expect(evaluate(2000).desired).toBe(2);
  expect(evaluate(16_000).desired).toBe(1);
});
it("delayed metrics exclude recent CPU changes", () => {
  const f = fleets.createFleet(2),
    r = resourceLesson(),
    c = hpaLesson().controller;
  c.settings.metrics[0].windowMs = 1000;
  c.settings.metrics[0].metricDelayMs = 2000;
  for (let time = 1000; time <= 5000; time += 1000) {
    fleets.chargeCpu(f, undefined, time <= 2000 ? 100 : 2000);
    fleets.integrateResources(f, 0, time, 1000);
  }
  expect(fleets.evaluateHpa(f, c, r, 4000)).toMatchObject({ raw: 1, metric: 10 });
  expect(fleets.evaluateHpa(f, c, r, 5000)).toMatchObject({ raw: 6, metric: 200 });
});
it("resource windows reuse aggregates across frames and refresh publication and denominators", () => {
  const f = fleets.createFleet(2),
    r = resourceLesson();
  for (let time = 1000; time <= 600_000; time += 1000) {
    fleets.chargeCpu(f, undefined, 1000);
    fleets.integrateResources(f, 2, time, 1000);
  }
  const counted = countingReads(f.samples);
  f.samples = counted.items;
  const a = fleets.resourceReadout(f, r, 2, 600_000, 10);
  const before = counted.reads();
  for (let i = 1; i < 60; i++) expect(fleets.resourceReadout(f, r, 2, 600_000 + i * 10, 10)).toEqual(a);
  expect(counted.reads() - before).toBeLessThan(600);
  f.ready = 4;
  expect(fleets.resourceReadout(f, r, 2, 600_500, 10).cpuRequestPct).toBe(a.cpuRequestPct! / 2);
  fleets.chargeCpu(f, undefined, 3000);
  fleets.integrateResources(f, 4, 601_000, 1000);
  expect(fleets.resourceReadout(f, r, 4, 601_000, 10).cpuRequestPct).toBeGreaterThan(a.cpuRequestPct! / 2);
});
it("readiness visits due cohorts without rebuilding the full replica index", () => {
  const f = fleets.createFleet(1),
    r = resourceLesson();
  r.startup = { delayMs: 600_000, jitterFraction: 0.5 };
  fleets.reconcileFleet(f, 10_000, r, 0, 42, "worker");
  const map = vi.spyOn(f.starts, "map");
  const ranges = countingReads(f.ranges);
  f.ranges = ranges.items;
  for (let time = 300_000; time <= 310_000; time += 10) fleets.advanceFleet(f, time);
  expect(f.ready).toBeGreaterThan(1);
  expect(map).not.toHaveBeenCalled();
  expect(ranges.reads()).toBe(0);
  expect(f.replicaIndexDirty).toBe(true);
  expect(fleets.replicaPage(f, r, 310_000, 1)).toHaveLength(50);
  expect(f.replicaIndexDirty).toBe(false);
});
it("bounds aggregate CPU parts during partial jittered startup and recovers on release", () => {
  const f = fleets.createFleet(1),
    r = resourceLesson();
  r.startup = { delayMs: 5000, jitterFraction: 0.5 };
  fleets.reconcileFleet(f, 10_000, r, 10, 42, "worker");
  fleets.advanceFleet(f, 5010);
  const working: { cpuParts?: NonNullable<ReturnType<typeof sampledParts>> }[] = [];
  for (let i = 0; i < 200; i++) {
    const cpuParts = sampledParts(f, f.ready, 1_000_000, working);
    if (!cpuParts) break;
    working.push({ cpuParts });
  }
  expect(working.length).toBeLessThan(200);
  expect(f.partBudget.blocked).toBe(true);
  expect(f.partBudget.used).toBe(working.reduce((sum, w) => sum + (w.cpuParts?.length ?? 0), 0));
  expect(f.partBudget.used).toBeLessThanOrEqual(MAX_CPU_PARTS);
  // A drain cannot exceed the same budget through splitting existing active intervals.
  const splitting = fleets.createFleet(4);
  const occupied = [{ cpuParts: sampledParts(splitting, 4, 1000, [])! }];
  splitting.partBudget.used = MAX_CPU_PARTS;
  expect(canDrainSampled(splitting, 2, occupied)).toBe(false);
  for (const w of working) releaseCpuParts(f, w);
  expect(f.partBudget.used).toBe(0);
  fleets.advanceFleet(f, 10_000);
  f.rangesDirty = true;
  expect(sampledParts(f, f.ready, 1000, [])).toHaveLength(1);
});

it("enabling resources while paused anchors new deadlines to the enable time (fuzzer seed 3)", () => {
  const d = fixed();
  d.nodes[1].props!.resources = undefined;
  const e = load(d);
  e.step(1000);
  e.setNodeStatus("worker", "paused");
  e.step(300);
  e.setNodeProps("worker", { resources: { ...resourceLesson(), startup: { delayMs: 100, jitterFraction: 0 } } });
  e.setNodeProps("worker", { replicas: 2 });
  e.step(300);
  e.setNodeStatus("worker", "up");
  e.step(90);
  expect(e.frame().nodes.worker.fleet).toMatchObject({ ready: 1, starting: 1 });
  e.step(10);
  expect(e.frame().nodes.worker.fleet).toMatchObject({ ready: 2, starting: 0 });
});

it("cached windows follow exact publication boundaries after a pause", () => {
  const f = fleets.createFleet(1),
    r = resourceLesson();
  f.samples = [{ at: 1160, cpu: 1000, occupancy: 1, ready: 1 }];
  expect(fleets.resourceReadout(f, r, 1, 1150, 10).cpuRequestPct).toBeUndefined();
  expect(fleets.resourceReadout(f, r, 1, 1170, 10).cpuRequestPct).toBe(200);
});

it("CPU-budget-refused HPA shrinks keep actual desired and applied policy history", () => {
  const original = fleets.createFleet;
  let fleet: fleets.Fleet | undefined;
  const spy = vi.spyOn(fleets, "createFleet").mockImplementation((...args) => (fleet = original(...args)));
  try {
    const d = fixed(),
      a = hpaLesson();
    Object.assign(a.controller, { initialReplicas: 4, maxReplicas: 4 });
    a.controller.settings.syncMs = 1000;
    a.controller.settings.metrics[0].windowMs = 1000;
    a.controller.settings.down.stabilizationMs = 0;
    Object.assign(d.nodes[1].props!, { autoscaling: a, concurrency: 4, latencyMs: 10_000, api: {} });
    const e = createEngine({ seed: 42, scale: 10 });
    e.load(d);
    e.inject("source", 1);
    e.step(990);
    expect(e.frame().nodes.worker.inFlight).toBe(1);
    const f = fleet!;
    const used = f.partBudget.used;
    // Other fleets can exhaust the shared budget between this attempt's admission and HPA's sync.
    f.partBudget.used = MAX_CPU_PARTS;
    e.step(10);
    expect(e.trafficLimit()).toBe("resources");
    expect(f.decision).toMatchObject({ raw: 1, desired: 4, reason: "policy" });
    expect(f.desired).toBe(4);
    expect(f.changes).toEqual([]);
    f.partBudget.used = used;
    e.step(1000);
    expect(f.desired).toBe(1);
    expect(f.changes).toEqual([{ at: 2000, delta: -3 }]);
  } finally {
    spy.mockRestore();
  }
});
