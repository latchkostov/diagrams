import { expect, it, vi } from "vitest";
import { waitingFixture } from "../lab/waitingFixture";
import { hpaLesson, resourceLesson } from "../model/autoscaling";
import { validateDiagram } from "../interop/native";
import type { Simulation } from "../model/types";
import { createEngine, SOURCE_VOLUME_CAP, WorkBudgetError } from "./engine";
import { createSimulationRun } from "./simulation";
import { autoScale } from "./scale";
import { realSnapshot } from "./units";
import { countingReads, GROWTH_FACTOR, LINEAR_LIMIT } from "../test/complexity";

it.each(["reply", "local"])("sampled failed replies preserve caller capacity (%s)", (failure) => {
  const d = waitingFixture();
  d.nodes[1].props!.concurrency = 1;
  if (failure === "reply") d.nodes[2].props!.api = { latencyMs: 250, errorRate: 1 };
  else d.nodes[1].props!.failureRate = 1;
  const counts = [1, 10].map((scale) => {
    const e = createEngine({ scale, maxParticles: 0 });
    e.load(d);
    e.inject("source", 2000 / scale);
    e.step(failure === "reply" ? 30_000 : 1000);
    const failed = realSnapshot(e.snapshot()).nodes.caller.failed;
    e.step(600_000);
    expect(realSnapshot(e.snapshot()).nodes.caller.failed).toBe(2000);
    expect(e.snapshot().nodes.caller.threads).toMatchObject({ working: 0, waiting: 0, queued: 0 });
    expect(e.snapshot().inSystem).toBe(0);
    return failed;
  });
  expect(Math.abs(counts[1] - counts[0])).toBeLessThanOrEqual(10);
});

it.each(["reply", "local"])("sampled retained retries preserve caller capacity (%s)", (failure) => {
  const d = waitingFixture();
  d.nodes[0].stencil = "generic.queue";
  d.nodes[0].props!.maxDeliveryCount = 2;
  Object.assign(d.nodes[1].props!, { concurrency: 1, retry: "inplace", retryBackoffMs: 0 });
  if (failure === "reply") d.nodes[2].props!.api = { latencyMs: 250, errorRate: 1 };
  else d.nodes[1].props!.failureRate = 1;
  const counts = [1, 10].map((scale) => {
    const e = createEngine({ scale, maxParticles: 0 });
    e.load(d);
    e.inject("source", 1000 / scale);
    e.step(failure === "reply" ? 300_000 : 1000);
    const failed = realSnapshot(e.snapshot()).nodes.caller.failed;
    e.step(600_000);
    expect(realSnapshot(e.snapshot()).nodes.caller.failed).toBe(2000);
    expect(e.snapshot().inSystem).toBe(0);
    expect(e.snapshot().nodes.caller.threads).toMatchObject({ working: 0, waiting: 0, queued: 0 });
    return failed;
  });
  expect(Math.abs(counts[1] - counts[0])).toBeLessThanOrEqual(10);
});

it.each(["reply", "local"])("sampled managed retries preserve endpoint residence (%s)", (failure) => {
  const d = waitingFixture();
  d.nodes[0].stencil = "generic.queue";
  d.nodes[0].props!.maxDeliveryCount = 2;
  d.nodes[1].stencil = "aws.lambda";
  Object.assign(d.nodes[1].props!, {
    concurrency: 1,
    maxConcurrency: 1,
    scaling: "fixed",
    retry: "inplace",
    retryBackoffMs: 0,
    api: { latencyMs: 10 },
    endpoints: [
      {
        id: "one",
        method: "GET",
        path: "/",
        behaviour: { maxInFlight: 1, latencyMs: 100, errorRate: failure === "local" ? 1 : 0 },
      },
    ],
  });
  d.edges[0].kind = "sync";
  d.edges[0].props!.endpointId = "one";
  if (failure === "reply") d.nodes[2].props!.api = { latencyMs: 250, errorRate: 1 };
  const e = createEngine({ scale: 10, maxParticles: 0 });
  e.load(d);
  e.inject("source", 1);
  const untilFailed = (count: number) => {
    for (let i = 0; i < 1000 && e.snapshot().nodes.caller.failed < count; i++) e.step(10);
    expect(e.snapshot().nodes.caller.failed).toBe(count);
    return e.snapshot().time;
  };
  const first = untilFailed(1),
    second = untilFailed(2);
  expect(first / (100 + (failure === "reply" ? 250 : 0))).toBeGreaterThanOrEqual(10);
  expect((second - first) / first).toBeGreaterThan(0.95);
  e.step(1000);
  expect(e.snapshot().inSystem).toBe(0);
});

it.each(["shared", "endpoint"])("sampled callers preserve shared and endpoint concurrency capacity (%s)", (scope) => {
  const d = waitingFixture();
  d.nodes[1].stencil = "aws.lambda";
  Object.assign(d.nodes[1].props!, { concurrency: 100, scaling: "fixed", maxConcurrency: 100, api: { latencyMs: 10 } });
  if (scope === "shared") {
    d.planning!.sharedAllocations = [{ id: "account", maxInFlight: 1 }];
    d.nodes[1].props!.api = { latencyMs: 10, sharedConcurrency: "account" };
  } else {
    d.nodes[1].props!.endpoints = [{ id: "one", method: "GET", path: "/", behaviour: { maxInFlight: 1 } }];
    d.edges[0].kind = "sync";
    d.edges[0].props!.endpointId = "one";
  }
  const counts = [1, 10].map((scale) => {
    const e = createEngine({ scale, maxParticles: 0 });
    e.load(d);
    for (let i = 0; i < 1000; i++) {
      e.inject("source", 30 / scale);
      e.step(30);
    }
    const processed = realSnapshot(e.snapshot()).nodes.caller.processed;
    e.step(10_000);
    expect(e.snapshot().inSystem).toBe(0);
    return processed;
  });
  expect(Math.abs(counts[1] - counts[0])).toBeLessThanOrEqual(10);
});

it("retained caller retries use their renewed admission reservation", () => {
  const d = waitingFixture();
  d.nodes[0].stencil = "generic.queue";
  d.nodes[0].props!.maxDeliveryCount = 2;
  d.nodes[1].stencil = "aws.lambda";
  Object.assign(d.nodes[1].props!, {
    concurrency: 100,
    maxConcurrency: 100,
    scaling: "fixed",
    retry: "inplace",
    retryBackoffMs: 0,
    api: { latencyMs: 10 },
    endpoints: [{ id: "one", method: "GET", path: "/", behaviour: { maxInFlight: 2 } }],
  });
  d.edges[0].kind = "sync";
  d.edges[0].props!.endpointId = "one";
  d.nodes[2].props!.api = { latencyMs: 250, errorRate: 1 };
  const e = createEngine({ scale: 10, maxParticles: 0 });
  e.load(d);
  e.inject("source", 1);
  const untilFailed = (count: number) => {
    for (let i = 0; i < 1000 && e.snapshot().nodes.caller.failed < count; i++) e.step(10);
    expect(e.snapshot().nodes.caller.failed).toBe(count);
    return e.snapshot().time;
  };
  const first = untilFailed(1);
  e.setNodeProps("caller", {
    endpoints: [{ id: "one", method: "GET", path: "/", behaviour: { maxInFlight: 1 } }],
  });
  const second = untilFailed(2);
  expect((second - first) / first).toBeGreaterThan(1.8);
  e.step(1000);
  expect(e.snapshot().inSystem).toBe(0);
  expect(e.snapshot().nodes.caller.threads).toMatchObject({ working: 0, waiting: 0, queued: 0 });
});

it("changing setScale mid-run still drains sampled caller releases", () => {
  const d = waitingFixture();
  d.nodes[1].props!.concurrency = 1;
  const e = createEngine({ scale: 10 });
  e.load(d);
  e.inject("source", 1);
  e.step(500);
  expect(e.snapshot().nodes.caller.threads!.waiting).toBeGreaterThan(0);
  e.setScale(1);
  e.step(10_000);
  expect(e.snapshot().nodes.caller.processed).toBe(1);
  expect(e.snapshot().inSystem).toBe(0);
  expect(e.snapshot().nodes.caller.threads).toMatchObject({ working: 0, waiting: 0, queued: 0 });
});

it("counts ramp startup volume in linear stage reads", () => {
  const reads = (count: number) => {
    const stages = countingReads(Array.from({ length: count }, () => ({ durationMs: 1, targetRate: 0 })));
    createSimulationRun(waitingFixture(), {
      id: "ramp",
      title: "Ramp",
      traffic: [{ id: "r", node: "source", shape: { kind: "ramp", stages: stages.items } }],
    });
    return stages.reads();
  };
  expect(reads(100 * GROWTH_FACTOR) / reads(100)).toBeLessThan(LINEAR_LIMIT);
});

it.each([
  [3, 2],
  [1, 10],
  [9, 10],
])("sampled filtered calls preserve local work capacity (%i slots, scale %i)", (capacity, scale) => {
  const d = waitingFixture();
  d.nodes[1].props!.concurrency = capacity;
  d.edges[1].props!.filter = ["unused"];
  const counts = [1, scale].map((weight) => {
    const e = createEngine({ scale: weight, maxParticles: 0 });
    e.load(d);
    e.inject("source", 20_000);
    e.step((10_000 * scale) / capacity);
    expect(e.snapshot().nodes.partner.processed).toBe(0);
    const t = realSnapshot(e.snapshot()).nodes.caller.threads!;
    expect(t.waiting).toBe(0);
    expect(t.working).toBeLessThanOrEqual(capacity + 1e-9);
    return realSnapshot(e.snapshot()).nodes.caller.processed;
  });
  expect(Math.abs(counts[1] / counts[0] - 1)).toBeLessThan(0.01);
});

it.each([1, 10, 500])("sampled resource callers charge CPU residence once (%i CPU-ms)", (cpu) => {
  const d = waitingFixture();
  Object.assign(d.nodes[1].props!, {
    concurrency: 1,
    resources: { ...resourceLesson(), cpuMsPerMessage: cpu, startup: { delayMs: 0, jitterFraction: 0 } },
  });
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = { concurrency: 1000, latencyMs: 250, jitter: 0 };
  const counts = [1, 100].map((scale) => {
    const e = createEngine({ scale, maxParticles: 0 });
    e.load(d);
    expect(e.snapshot().scale).toBe(scale);
    e.inject("source", 20_000);
    e.step(11_000 * (Math.max(10, cpu) + 250));
    return realSnapshot(e.snapshot()).nodes.caller.processed;
  });
  expect(Math.abs(counts[1] - counts[0])).toBeLessThanOrEqual(100);
  expect(Math.abs(counts[1] / counts[0] - 1)).toBeLessThan(0.01);
});

it.each(["aws.lambda", "azure.functions"])("admits a sampled request into a partial managed pool (%s)", (stencil) => {
  const d = waitingFixture();
  d.nodes[1].stencil = stencil;
  Object.assign(d.nodes[1].props!, { concurrency: 1, maxConcurrency: 1, scaling: "fixed", api: { latencyMs: 10 } });
  const e = createEngine({ scale: 4 });
  e.load(d);
  expect(e.snapshot().scale).toBe(4);
  e.inject("source", 1);
  drain(e, 4);
  expect(e.snapshot().nodes.caller.rejected).toBe(0);
});

it("nested sampled callers account for a downstream sampling delay once", () => {
  const d = waitingFixture();
  d.nodes[1].props!.concurrency = 1;
  d.nodes.push({ ...d.nodes[1], id: "middle", props: { ...d.nodes[1].props } });
  d.edges[1].to = "middle";
  d.edges.push({ id: "nested", from: "middle", to: "partner", kind: "sync" });
  const counts = [1, 10].map((scale) => {
    const e = createEngine({ scale, maxParticles: 0 });
    e.load(d);
    expect(e.snapshot().scale).toBe(scale);
    e.inject("source", 2000);
    e.step(300_000);
    return realSnapshot(e.snapshot()).nodes.caller.processed;
  });
  expect(Math.abs(counts[1] / counts[0] - 1)).toBeLessThan(0.01);
});

function drain(engine: ReturnType<typeof createEngine>, count = 16) {
  for (let i = 0; i < 600; i++) {
    engine.step(10);
    const t = realSnapshot(engine.snapshot()).nodes.caller.threads!;
    expect(t.working + t.waiting).toBeLessThanOrEqual(t.slots + 1e-9);
  }
  const s = realSnapshot(engine.snapshot());
  expect(s.nodes.caller.processed).toBe(count);
  expect(s.nodes.result.processed).toBe(count);
  expect(s.nodes.caller.threads).toMatchObject({ working: 0, waiting: 0, queued: 0 });
  expect(s.inSystem).toBe(0);
}

it.each([0, 500])("sampled runs drain after timeline pool reductions (%i)", (atMs) => {
  const run = createSimulationRun(waitingFixture(), {
    id: "run",
    title: "Run",
    scale: 4,
    durationMs: 6000,
    traffic: [{ id: "burst", node: "source", shape: { kind: "burst", count: 16 } }],
    timeline: [{ atMs, action: { do: "props", node: "caller", props: { concurrency: 1 } } }],
  });
  for (let i = 0; i < 600; i++) {
    run.step(10);
    const t = run.units.realSnapshot().nodes.caller.threads!;
    expect(t.working + t.waiting).toBeLessThanOrEqual(t.slots + 1e-9);
  }
  expect(run.units.realSnapshot().nodes.caller.processed).toBe(16);
  expect(run.units.realSnapshot().nodes.caller.threads?.queued).toBe(0);
  expect(run.units.realSnapshot().inSystem).toBe(0);
});

it.each([{ replicas: 1 }, { concurrency: 1 }])("sampled callers drain after a live pool decrease (%j)", (patch) => {
  const d = waitingFixture();
  Object.assign(d.nodes[1].props!, { replicas: patch.replicas ? 4 : 1, concurrency: patch.concurrency ? 4 : 1 });
  const e = createEngine({ scale: 4 });
  e.load(d);
  e.inject("source", 4);
  e.step(100);
  e.setNodeProps("caller", patch);
  const checkpoint = e.checkpoint();
  drain(e);
  const expected = e.snapshot();
  e.restore(checkpoint);
  drain(e);
  expect(e.snapshot()).toEqual(expected);
  e.setNodeProps("caller", { replicas: 2, concurrency: 3 });
  e.inject("source", 4);
  drain(e, 32);
});

it("sampled callers drain after an autoscaler downscale", () => {
  const d = waitingFixture(),
    a = hpaLesson();
  Object.assign(a.controller, { initialReplicas: 4, minReplicas: 1 });
  Object.assign(a.controller.settings, { syncMs: 1000, initialReadinessDelayMs: 0, cpuInitializationPeriodMs: 0 });
  a.controller.settings.metrics[0].windowMs = 1000;
  a.controller.settings.down.stabilizationMs = 0;
  Object.assign(d.nodes[1].props!, {
    concurrency: 1,
    autoscaling: a,
    resources: { ...resourceLesson(), cpuMsPerMessage: 0, startup: { delayMs: 0, jitterFraction: 0 } },
  });
  const e = createEngine({ scale: 4 });
  e.load(d);
  e.step(2000);
  expect(e.fleet("caller")?.desired).toBe(1);
  expect(e.fleet("caller")?.ready).toBe(1);
  e.inject("source", 4);
  drain(e);
});

it("coprime caller pools keep coarse sampling and continuous traffic", () => {
  const d = waitingFixture();
  d.nodes[0].props!.ratePerSec = 200_000;
  d.nodes[1].props!.concurrency = 1000;
  d.nodes.push({ ...d.nodes[1], id: "other", props: { ...d.nodes[1].props, concurrency: 1001 } });
  d.edges.push({ id: "other-call", from: "other", to: "partner", kind: "sync" });
  const scale = autoScale({ id: "s", title: "s", traffic: [] }, d);
  expect(scale).toBe(250);
  const e = createEngine({ scale });
  e.load(d);
  expect(e.snapshot().scale).toBe(250);
  expect(e.trafficLimit()).toBeUndefined();
  e.setTraffic(true);
  e.step(100);
  expect(e.snapshot().nodes.source.processed).toBeGreaterThan(0);
});

it.each(["bursts", "rate"])("bounds the review's %s import at the saved scale", (kind) => {
  const d = waitingFixture();
  d.nodes[1].props!.concurrency = 1;
  const s: Simulation = {
    id: "s",
    title: "s",
    scale: kind === "bursts" ? 1000 : 30_000,
    durationMs: 600_000,
    traffic:
      kind === "bursts"
        ? Array.from({ length: 2000 }, (_, i) => ({
            id: `b${i}`,
            node: "source",
            shape: { kind: "burst", count: 100_000 },
          }))
        : [{ id: "rate", node: "source", shape: { kind: "constant", ratePerSec: 10_000_000, durationMs: 600_000 } }],
  };
  expect(validateDiagram({ ...d, simulations: [s] }).ok).toBe(true);
  const e = createEngine();
  const inject = vi.spyOn(e, "inject").mockImplementation(() => {});
  const run = createSimulationRun(d, s, { engine: e });
  run.step(600_000);
  const scheduled = inject.mock.calls.reduce((sum, [, count]) => sum + count, 0);
  expect(scheduled).toBe(SOURCE_VOLUME_CAP);
  expect(run.state().scale).toBe(s.scale);
});

it("rejects oversized scripted input before startup actions or bursts", () => {
  const e = createEngine(),
    inject = vi.spyOn(e, "inject");
  expect(() =>
    createSimulationRun(
      waitingFixture(),
      {
        id: "s",
        title: "s",
        traffic: [{ id: "burst", node: "source", shape: { kind: "burst", count: SOURCE_VOLUME_CAP + 1 } }],
        timeline: [{ atMs: 0, action: { do: "inject", node: "source", count: 1 } }],
      },
      { engine: e },
    ),
  ).toThrow(WorkBudgetError);
  expect(inject).not.toHaveBeenCalled();
});

it("bounds scripted traffic after live multiplier changes and restores its budget with checkpoints", () => {
  const e = createEngine(),
    inject = vi.spyOn(e, "inject").mockImplementation(() => {});
  const run = createSimulationRun(
    waitingFixture(),
    {
      id: "s",
      title: "s",
      durationMs: 2000,
      traffic: [
        { id: "rate", node: "source", shape: { kind: "constant", ratePerSec: SOURCE_VOLUME_CAP, durationMs: 1000 } },
      ],
    },
    { engine: e },
  );
  run.step(500);
  const checkpoint = run.checkpoint();
  run.setMultipliers({ traffic: 1000 });
  expect(() => run.step(500)).toThrow(WorkBudgetError);
  run.restore(checkpoint);
  run.step(500);
  expect(inject.mock.calls.reduce((sum, [, count]) => sum + count, 0)).toBe(SOURCE_VOLUME_CAP);
});
