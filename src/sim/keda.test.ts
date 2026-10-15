import { describe, it, expect, vi } from "vitest";
import { createEngine } from "./engine";
import { createFleet } from "./autoscaling";
import { evaluateKeda, resetKeda, triggerValue } from "./keda";
import { kedaLesson, resourceLesson } from "../model/autoscaling";
import { kedaFixture } from "../lab/kedaFixture";
import example from "../examples/keda-render-workers.json";
import type { DiagramFile } from "../model/types";
import { createSimulationRun } from "./simulation";
import { Deque } from "./deque";

describe("KEDA activation and generated HPA", () => {
  it("keeps KEDA activation out of HPA's rolling change budget", () => {
    const d = kedaFixture();
    d.nodes[0].props!.partitions = 20;
    const e = createEngine();
    e.load(d);
    e.inject("uploads", 95);
    e.step(1000);
    expect(e.frame().nodes.worker.fleet!.desired).toBe(1);
    e.step(1000);
    expect(e.frame().nodes.worker.fleet!.decision).toMatchObject({ raw: 10, desired: 5, reason: "policy" });
  });
  it("shows zero, waking, backlog drain and return to zero within ten seconds in the public example", () => {
    const d = example as DiagramFile,
      run = createSimulationRun(d, d.simulations![0]);
    expect(run.engine.frame().nodes.worker.fleet!.ready).toBe(0);
    run.step(2000);
    expect(run.engine.frame().nodes.worker.fleet).toMatchObject({ desired: 1, ready: 0, starting: 1 });
    expect(run.engine.frame().nodes.uploads.backlog).toBe(80);
    run.step(8000);
    expect(run.engine.frame().nodes.worker).toMatchObject({ processed: 80, fleet: { ready: 0, desired: 0 } });
    expect(run.engine.frame().nodes.uploads.backlog).toBe(0);
  });
  it("uses one indexed metric read without traversing queued messages", () => {
    for (const count of [1000, 8000]) {
      const e = createEngine();
      e.load(kedaFixture());
      e.inject("uploads", count);
      const reads = vi.spyOn(Deque.prototype, Symbol.iterator);
      try {
        e.step(1000);
        expect(reads).not.toHaveBeenCalled();
      } finally {
        reads.mockRestore();
      }
      expect(e.frame().nodes.worker.fleet!.desired).toBe(1);
    }
  });
  it.each([1, 10])("reads actual queue and subscription visibility at scale %s", (scale) => {
    for (const type of ["azure-servicebus", "aws-sqs-queue", "rabbitmq"] as const) {
      for (const inFlight of [false, true]) {
        const d = kedaFixture(),
          c = kedaLesson(type, { node: "uploads", ...(type === "azure-servicebus" ? { group: "renders" } : {}) });
        d.nodes[0].stencil =
          type === "azure-servicebus"
            ? "azure.service-bus.topic"
            : type === "aws-sqs-queue"
              ? "aws.sqs"
              : "rabbitmq.queue";
        Object.assign(c.controller, { minReplicas: 1, initialReplicas: 1, pollingMs: 1000 });
        c.controller.settings.syncMs = 1000;
        const trigger = c.controller.triggers[0];
        if (trigger.type === "aws-sqs-queue") trigger.scaleOnInFlight = inFlight;
        if (trigger.type === "rabbitmq") {
          trigger.protocol = inFlight ? "http" : "amqp";
          trigger.excludeUnacknowledged = !inFlight;
        }
        d.nodes[1].props!.autoscaling = c;
        d.nodes[1].props!.latencyMs = 60_000;
        const e = createEngine({ scale });
        e.load(d);
        e.inject("uploads", 13);
        e.step(1000);
        const s = e.frame(),
          decision = s.nodes.worker.fleet!.decision!;
        const includesInFlight = type !== "azure-servicebus" && inFlight;
        expect(decision.metric).toBe((includesInFlight ? 13 : s.nodes.uploads.backlog) * scale);
        expect(s.nodes.worker.processed).toBe(0);
      }
    }
  });
  it("keeps excess Kafka readers idle while spare workers can serve HTTP", () => {
    const d = kedaFixture(),
      a = kedaLesson("kafka", { node: "uploads", group: "renders" });
    Object.assign(a.controller, { minReplicas: 8, initialReplicas: 8, maxReplicas: 10 });
    const trigger = a.controller.triggers[0];
    if (trigger.type === "kafka") trigger.allowIdleConsumers = true;
    d.nodes[1].props!.autoscaling = a;
    const e = createEngine();
    e.load(d);
    e.inject("uploads", 300);
    e.step(1000);
    expect(e.frame().nodes.worker).toMatchObject({ activeReplicas: 3, idleReplicas: 5 });
    const logOnly = e.frame().nodes.worker.processed;
    d.nodes.push({ id: "http", stencil: "client.browser", label: "HTTP", x: 0, y: 0 });
    d.edges.push({ id: "http-work", from: "http", to: "worker", kind: "sync", props: { travelMs: 10 } });
    e.load(d);
    e.inject("uploads", 300);
    e.inject("http", 300);
    e.step(1000);
    expect(e.frame().nodes.worker.activeReplicas).toBe(8);
    expect(e.frame().nodes.worker.processed).toBeGreaterThan(logOnly);
  });
  it("keeps strict activation separate from HPA, startup, cooldown and stabilization", () => {
    const d = kedaFixture(),
      a = kedaLesson("kafka", { node: "uploads", group: "renders" });
    Object.assign(a.controller, { pollingMs: 1000, cooldownMs: 3000 });
    a.controller.triggers[0].activation = 5;
    a.controller.settings.syncMs = 1000;
    d.nodes[1].props!.autoscaling = a;
    const e = createEngine({ seed: 7 });
    e.load(d);
    e.inject("uploads", 5);
    e.step(1000);
    expect(e.snapshot().nodes.worker.fleet).toMatchObject({ desired: 0, ready: 0, decision: { reason: "inactive" } });
    e.inject("uploads", 1);
    e.step(990);
    expect(e.snapshot().nodes.worker.fleet!.desired).toBe(0);
    e.step(10);
    expect(e.snapshot().nodes.worker.fleet).toMatchObject({
      desired: 1,
      starting: 1,
      ready: 0,
      decision: { reason: "activation" },
    });
    e.step(990);
    expect(e.snapshot().nodes.worker.processed).toBe(0);
    e.step(10);
    expect(e.snapshot().nodes.worker.fleet!.ready).toBe(1);
    e.step(1000); // Last active poll was at 3000; threshold is now inactive.
    expect(e.snapshot().nodes.worker.fleet!.desired).toBe(1);
    const cp = e.checkpoint();
    e.step(1990);
    expect(e.snapshot().nodes.worker.fleet!.desired).toBe(1);
    e.step(10);
    expect(e.snapshot().nodes.worker.fleet!.desired).toBe(0);
    const result = e.snapshot();
    e.restore(cp);
    e.setSpeed(4);
    e.step(2000 / 4);
    expect(e.snapshot()).toEqual(result);
  });
  it("calculates lag 95 / 10 = 10, caps Kafka at three partitions, independently per group", () => {
    const c = kedaLesson("kafka", { node: "broker", group: "a" }).controller;
    const f = createFleet(1);
    resetKeda(f, c, 0);
    const read = vi.fn(() => ({ pending: 95, outstanding: 0, partitions: 3 }));
    expect(evaluateKeda(f, c, resourceLesson(), 15_000, read)).toMatchObject({
      raw: 10,
      desired: 3,
      reason: "partitions",
    });
    const d = kedaFixture();
    d.edges[0].props!.filter = ["Render"];
    d.edges.push({ id: "other", from: "uploads", to: "worker", props: { group: "other", filter: ["Other"] } });
    const e = createEngine({ seed: 7 });
    e.load(d);
    e.inject("uploads", 95, { type: "Other" });
    e.step(1000);
    expect(e.snapshot().nodes.worker.fleet!.desired).toBe(0);
    e.inject("uploads", 95, { type: "Render" });
    e.step(1000);
    expect(e.snapshot().nodes.worker.fleet!.desired).toBe(1);
    e.step(1000);
    expect(e.snapshot().nodes.worker.fleet!.decision).toMatchObject({ raw: 10, desired: 3 });
  });
  it("does not gate 1→N on activation when min is positive and uses largest trigger", () => {
    const c = kedaLesson().controller;
    c.minReplicas = c.initialReplicas = 1;
    c.triggers[0].activation = 1000;
    c.triggers.push({ ...kedaLesson("aws-sqs-queue").controller.triggers[0], source: { node: "q" } });
    const f = createFleet(1);
    resetKeda(f, c, 0);
    expect(
      evaluateKeda(f, c, resourceLesson(), 15_000, (t) => ({
        pending: t.type === "kafka" ? 95 : 40,
        outstanding: 0,
        partitions: 3,
      })),
    ).toMatchObject({ raw: 8, desired: 5, reason: "policy", broker: "q" });
  });
  it("uses the initial cooldown only until the first actual activity", () => {
    const c = kedaLesson("aws-sqs-queue").controller;
    Object.assign(c, { pollingMs: 1000, initialCooldownMs: 60000, cooldownMs: 1000 });
    const f = createFleet(1);
    resetKeda(f, c, 0);
    expect(evaluateKeda(f, c, resourceLesson(), 1000, () => ({ pending: 0, outstanding: 0 }))).toBeUndefined();
    expect(f.desired).toBe(1);
    evaluateKeda(f, c, resourceLesson(), 2000, () => ({ pending: 10, outstanding: 0 }));
    expect(evaluateKeda(f, c, resourceLesson(), 3000, () => ({ pending: 0, outstanding: 0 }))).toMatchObject({
      desired: 0,
      cooldownUntil: 3000,
    });
  });
  it("explains the winning valid metric when another trigger falls back", () => {
    const c = kedaLesson("aws-sqs-queue", { node: "failed" }).controller;
    c.triggers.push({ ...c.triggers[0], source: { node: "healthy" } });
    c.fallback = { failureThreshold: 0, replicas: 2, behavior: "static" };
    const f = createFleet(1);
    resetKeda(f, c, 0);
    expect(
      evaluateKeda(f, c, resourceLesson(), 15000, (t) =>
        t.source.node === "failed" ? undefined : { pending: 50, outstanding: 0 },
      ),
    ).toMatchObject({ broker: "healthy", raw: 10, desired: 5, reason: "policy", metric: 50 });
  });
  it("observes per-trigger cache, error safety, fallback and recovery", () => {
    const c = kedaLesson("aws-sqs-queue", { node: "q" }).controller;
    c.fallback = { failureThreshold: 2, replicas: 4, behavior: "static" };
    c.triggers[0].useCachedMetrics = true;
    const f = createFleet(2);
    resetKeda(f, c, 0);
    const read = vi.fn(() => undefined);
    expect(evaluateKeda(f, c, resourceLesson(), 15_000, read)?.reason).toBe("missing");
    expect(read).not.toHaveBeenCalled();
    expect(evaluateKeda(f, c, resourceLesson(), 30_000, read)?.desired).toBe(2);
    expect(evaluateKeda(f, c, resourceLesson(), 45_000, read)?.desired).toBe(2);
    expect(evaluateKeda(f, c, resourceLesson(), 60_000, read)?.desired).toBe(2);
    expect(evaluateKeda(f, c, resourceLesson(), 90_000, read)).toMatchObject({ desired: 4, reason: "fallback" });
    expect(read).toHaveBeenCalledTimes(3);
    evaluateKeda(f, c, resourceLesson(), 120_000, () => ({ pending: 50, outstanding: 0 }));
    expect(f.keda!.failures).toEqual([0]);
  });
  it("keeps trigger reads bounded independently of queue size and only runs due clocks", () => {
    const c = kedaLesson().controller,
      f = createFleet(0);
    resetKeda(f, c, 0);
    const read = vi.fn(() => ({ pending: 100_000, outstanding: 0, partitions: 3 }));
    for (let now = 10; now <= 29_990; now += 10) evaluateKeda(f, c, resourceLesson(), now, read);
    expect(read).not.toHaveBeenCalled();
    evaluateKeda(f, c, resourceLesson(), 30_000, read);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it.each([1, 10])("reads broker real-unit counters without double counting at scale %s", (scale) => {
    const snapshot = { pending: 9 * scale, outstanding: 4 * scale };
    const trigger = (type: Parameters<typeof kedaLesson>[0]) => kedaLesson(type).controller.triggers[0];
    expect(triggerValue(trigger("kafka"), snapshot)).toBe(13 * scale);
    expect(triggerValue(trigger("azure-servicebus"), snapshot)).toBe(9 * scale);
    expect(triggerValue(trigger("aws-sqs-queue"), snapshot)).toBe(13 * scale);
    const rabbit = trigger("rabbitmq");
    expect(triggerValue(rabbit, snapshot)).toBe(9 * scale);
    expect(
      triggerValue({ ...rabbit, type: "rabbitmq", protocol: "http", excludeUnacknowledged: false }, snapshot),
    ).toBe(13 * scale);
  });
});
