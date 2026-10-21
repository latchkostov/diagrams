import { expect, it } from "vitest";
import { waitingFixture } from "../lab/waitingFixture";
import { cloudLesson, hpaLesson, kedaLesson, resourceLesson, type ScalingMetric } from "../model/autoscaling";
import { createResourceValidator } from "../model/resourceValidation";
import { createEngine } from "./engine";
import { assertLedgerInvariants } from "./resourceInvariants";
import { evaluateKeda } from "./keda";
import { autoscalingProblem } from "../model/autoscalingSchema";
import { createFleet, metricValue } from "./autoscaling";

const busy = (average = false): ScalingMetric => ({
  source: { kind: "pods", metric: "busyThreads" },
  target: average ? { kind: "averageValue", value: 2 } : { kind: "utilization", percentOfRequest: 50 },
  windowMs: 1000,
  metricDelayMs: 0,
});

it("busy-thread windows use per-ready-pod counts, Concurrency and metric delay", () => {
  const f = createFleet(4);
  f.concurrency = 16;
  f.samples.push({ at: 1000, cpu: 0, occupancy: 0, ready: 4, inFlight: 40 });
  expect(metricValue(f, resourceLesson(), busy(), 1000, 10)).toBe(62.5);
  expect(metricValue(f, resourceLesson(), busy(true), 1000, 10)).toBe(10);
  f.ready = 8;
  f.samples.push({ at: 2000, cpu: 0, occupancy: 0, ready: 8, inFlight: 40 });
  expect(metricValue(f, resourceLesson(), { ...busy(true), windowMs: 2000 }, 2000, 10)).toBe(7.5);
  expect(metricValue(f, resourceLesson(), { ...busy(), metricDelayMs: 1000 }, 2000, 10)).toBe(62.5);
});

it.each(["blocking", "non-blocking"] as const)("%s shares the ledger pool, queued deadlines are never sent", (wait) => {
  const d = waitingFixture();
  d.edges[1].props!.caller = { wait, poolConnections: 1, deadlineMs: 100, replyMs: 10 };
  const e = createEngine({ seed: 17, scale: 1, verifyLedger: assertLedgerInvariants });
  e.load(d);
  e.inject("source", 4);
  e.step(50);
  expect(e.snapshot().edges.call.calls).toMatchObject({ inFlight: 1, held: wait === "blocking" ? 4 : 0 });
  expect(e.snapshot().nodes.caller.threads).toMatchObject({ waiting: wait === "blocking" ? 4 : 0, working: 0 });
  const cp = e.checkpoint();
  e.step(1000);
  const s = e.snapshot();
  expect(s.nodes.partner.processed).toBe(1);
  expect(s.edges.call.calls).toMatchObject({ inFlight: 0, held: 0, timedOut: 4, late: 1 });
  expect(s.inSystem).toBe(0);
  e.restore(cp);
  e.step(1000);
  expect(e.snapshot()).toEqual(s);
});

it.each([false, true])("busy-thread HPA scales held calls (average per pod: %s)", (average) => {
  const d = waitingFixture();
  const a = hpaLesson();
  a.controller.settings.syncMs = 1000;
  a.controller.settings.metrics = [busy(average)];
  d.nodes[0].props = { ratePerSec: 40 };
  d.nodes[1].props = {
    ...d.nodes[1].props,
    resources: { ...resourceLesson(), cpuMsPerMessage: 0, startup: { delayMs: 0, jitterFraction: 0 } },
    autoscaling: a,
  };
  const e = createEngine({ seed: 17, scale: 1, verifyLedger: assertLedgerInvariants });
  e.load(d);
  e.setTraffic(true);
  e.step(5000);
  expect(e.snapshot().nodes.caller.fleet!.desired).toBeGreaterThan(1);
  expect(e.snapshot().nodes.caller.fleet!.decision?.metricKind).toBe(average ? "busyThreadsPerPod" : "busyThreads");
  expect(e.snapshot().nodes.caller.resources!.executedCpuMs).toBe(0);
});

it("KEDA's generated HPA reads busy threads", () => {
  const d = waitingFixture();
  d.nodes[0].stencil = "azure.service-bus.queue";
  d.nodes[0].props = {};
  const a = kedaLesson("azure-servicebus", { node: "source" });
  Object.assign(a.controller, { initialReplicas: 1, minReplicas: 1, maxReplicas: 10 });
  a.controller.triggers[0].target = 1e9;
  a.controller.settings.syncMs = 1000;
  a.controller.settings.metrics = [busy()];
  d.nodes[1].props = {
    ...d.nodes[1].props,
    resources: { ...resourceLesson(), cpuMsPerMessage: 0, startup: { delayMs: 0, jitterFraction: 0 } },
    autoscaling: a,
  };
  const e = createEngine({ seed: 17, scale: 1 });
  e.load(d);
  e.inject("source", 400);
  e.step(5000);
  expect(e.snapshot().nodes.caller.fleet!.desired).toBeGreaterThan(1);
});

it.each(["cloud-run", "app-service"] as const)("%s request samples count working plus held calls", (preset) => {
  const d = waitingFixture();
  d.nodes[2].props = { latencyMs: 5000, api: { latencyMs: 5000 }, jitter: 0 };
  const a = cloudLesson(preset);
  Object.assign(a.controller, { minReplicas: 1, initialReplicas: 1 });
  d.nodes[1].props = { ...d.nodes[1].props, resources: { ...resourceLesson(), cpuMsPerMessage: 0 }, autoscaling: a };
  let pressure = 0;
  const e = createEngine({
    seed: 17,
    scale: 1,
    verifyResources(s) {
      const n = [...s.nodes].find((n) => n.id === "caller")!;
      pressure = Math.max(pressure, n.fleet?.samples.at(-1)?.inFlight ?? 0);
    },
  });
  e.load(d);
  e.inject("source", 4);
  e.step(2000);
  expect(pressure).toBeGreaterThan(3);
});

it("validates busy-thread metrics without CPU requests, and gates them on W1", () => {
  const d = waitingFixture();
  const a = hpaLesson();
  a.controller.settings.metrics = [busy()];
  const r = resourceLesson();
  delete r.cpuRequestMilli;
  expect(autoscalingProblem(r, a)).toBeUndefined();
  d.nodes[1].props = { ...d.nodes[1].props, resources: r, autoscaling: a };
  expect(createResourceValidator()(d)).toBeUndefined();
  d.planning!.revision = "p3-a1";
  expect(createResourceValidator()(d)).toContain("Requests that wait");
});

it("records held-thread history before the busy metric is selected", () => {
  const d = waitingFixture();
  const a = hpaLesson();
  a.controller.settings.syncMs = 1000;
  a.controller.settings.metrics[0].windowMs = 1000;
  const r = { ...resourceLesson(), cpuMsPerMessage: 0, startup: { delayMs: 0, jitterFraction: 0 } };
  d.nodes[1].props = { ...d.nodes[1].props, resources: r, autoscaling: a };
  d.nodes[2].props = { latencyMs: 5000, api: { latencyMs: 5000 }, jitter: 0 };
  let observed: number | undefined;
  const e = createEngine({
    seed: 17,
    scale: 1,
    verifyResources(s) {
      const f = [...s.nodes].find((n) => n.id === "caller")!.fleet;
      if (f) observed = metricValue(f, r, busy(), s.time, 1);
    },
  });
  e.load(d);
  e.inject("source", 4);
  e.step(2000);
  expect(e.snapshot().nodes.caller.threads!.waiting).toBe(4);
  expect(observed).toBe(100);
});

it.each([false, true])("KEDA preserves the busy-thread winner over a broker (fallback: %s)", (fallback) => {
  const c = kedaLesson("kafka", { node: "broker" }).controller;
  Object.assign(c, { minReplicas: 4, initialReplicas: 4, maxReplicas: 10 });
  c.settings.metrics = [busy()];
  c.fallback = { failureThreshold: 0, replicas: 4, behavior: "static" };
  const f = createFleet(4);
  f.concurrency = 16;
  f.samples.push({ at: 15000, cpu: 0, occupancy: 0, ready: 4, inFlight: 64 });
  const d = evaluateKeda(f, c, resourceLesson(), 15000, () =>
    fallback ? undefined : { pending: 100000, outstanding: 0, partitions: 4 },
  );
  expect(d).toMatchObject({
    source: "pods",
    metricKind: "busyThreads",
    metric: 100,
    target: 50,
    raw: 8,
    desired: 8,
    reason: "target",
  });
  expect(d?.broker).toBeUndefined();
  expect(d?.group).toBeUndefined();
});

it.each([
  [1, false],
  [2, false],
  [1, true],
  [2, true],
] as const)(
  "sampled busy-thread utilization uses fleet Concurrency (scale=%s, reinitialize=%s)",
  (scale, reinitialize) => {
    const d = waitingFixture();
    const a = hpaLesson();
    Object.assign(a.controller, { minReplicas: 4, initialReplicas: 4, maxReplicas: 8 });
    a.controller.settings.syncMs = 1000;
    a.controller.settings.metrics = [{ ...busy(), target: { kind: "utilization", percentOfRequest: 70 } }];
    d.nodes[1].props = {
      concurrency: 16,
      replicas: 4,
      latencyMs: 0,
      jitter: 0,
      resources: { ...resourceLesson(), cpuMsPerMessage: 0 },
      autoscaling: a,
    };
    d.nodes[2].props = { latencyMs: 5000, api: { latencyMs: 5000 }, jitter: 0 };
    const e = createEngine({ seed: 17, scale });
    e.load(d);
    if (reinitialize) {
      const resources = { ...resourceLesson(), cpuMsPerMessage: 0 };
      e.setNodeProps("caller", { resources: undefined });
      e.setNodeProps("caller", { resources });
    }
    e.inject("caller", 40 / scale);
    e.step(1000);
    expect(e.snapshot().nodes.caller.fleet!.decision).toMatchObject({
      metric: 61.875,
      raw: 4,
      desired: 4,
      metricKind: "busyThreads",
    });
  },
);

it.each([false, true])("busy-thread HPA excludes non-blocking waits (per pod: %s)", (average) => {
  for (const poolConnections of [undefined, 1]) {
    const d = waitingFixture();
    const a = hpaLesson();
    a.controller.settings.syncMs = 1000;
    a.controller.settings.metrics = [busy(average)];
    d.nodes[1].props = {
      concurrency: 16,
      replicas: 1,
      latencyMs: 0,
      jitter: 0,
      resources: { ...resourceLesson(), cpuMsPerMessage: 0 },
      autoscaling: a,
    };
    d.nodes[2].props = { latencyMs: 5000, api: { latencyMs: 5000 }, jitter: 0 };
    d.edges[1].props = { ...d.edges[1].props, caller: { wait: "non-blocking", replyMs: 0, poolConnections } };
    const e = createEngine({ seed: 17, scale: 1, verifyLedger: assertLedgerInvariants });
    e.load(d);
    e.inject("caller", 16);
    e.step(2000);
    const s = e.snapshot();
    expect(s.edges.call.calls!.inFlight).toBe(poolConnections ?? 16);
    expect(s.nodes.caller.threads!.inFlight).toBeGreaterThan(0);
    expect(s.nodes.caller.threads).toMatchObject({ working: 0, waiting: 0 });
    expect(s.nodes.caller.fleet).toMatchObject({ desired: 1, decision: { metric: 0, desired: 1 } });
    if (poolConnections) expect(s.inSystem).toBeGreaterThan(s.edges.call.calls!.inFlight);
  }
});
