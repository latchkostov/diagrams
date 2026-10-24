import { expect, it, vi } from "vitest";
import { createEngine, observeEngineEvents } from "./engine";
import { Deque } from "./deque";
import { ShedQueue } from "./shedQueue";
import { queueGrant } from "./admission";
import { assertResilienceInvariants } from "./resilienceInvariants";
import { assertLedgerInvariants, assertOutcomeInvariants } from "./resourceInvariants";
import { realSnapshot } from "./units";
import { resourceLesson } from "../model/autoscalingLessons";
import { propsProblem } from "../model/simProps";
import type { DiagramFile } from "../model/types";
import type { QueuePolicy } from "./types";
import type { QueuePriority } from "./types";
import { parseNative } from "../interop/native";

function diagram(queue: QueuePolicy = { limit: 3 }, sync = false): DiagramFile {
  return {
    format: "diagrams/v2",
    title: "Queue shedding",
    planning: { revision: "p3-w2" },
    nodes: [
      { id: "source", stencil: "client.user", label: "Source", x: 0, y: 0, props: { jitter: 0 } },
      {
        id: "worker",
        stencil: "generic.service",
        label: "Worker",
        x: 300,
        y: 0,
        props: { queue, latencyMs: 100, concurrency: 1, replicas: 1, jitter: 0, status: "paused" },
      },
    ],
    edges: [
      {
        id: "input",
        from: "source",
        to: "worker",
        kind: sync ? "sync" : "async",
        props: {
          travelMs: 10,
          caller: {
            wait: "non-blocking",
            deadlineMs: 1000,
            retry: { maxAttempts: 1, backoffMs: 0, strategy: "fixed", retryOn: ["throttled"] },
          },
        },
      },
    ],
  };
}
function engine(d: DiagramFile, scale = 1) {
  const e = createEngine({
    scale,
    seed: 7,
    maxParticles: 0,
    verifyResilience: assertResilienceInvariants,
    verifyLedger: assertLedgerInvariants,
    verifyOutcomes: assertOutcomeInvariants,
  });
  e.load(d);
  return e;
}
it("deque back operations stay correct after shifts, compaction and clearing", () => {
  const q = new Deque<number>();
  for (let i = 0; i < 2050; i++) q.push(i);
  for (let i = 0; i < 2048; i++) expect(q.shift()).toBe(i);
  expect(q.peekBack()).toBe(2049);
  expect(q.pop()).toBe(2049);
  expect(q.pop()).toBe(2048);
  expect(q.pop()).toBeUndefined();
  q.push(7);
  expect([...q]).toEqual([7]);
  q.clear();
  expect(q.peekBack()).toBeUndefined();
});
it("priority service is FIFO/LIFO within classes; eviction picks newest/oldest of the lowest eligible class", () => {
  const q = new ShedQueue<{ id: number; priority?: "critical" | "normal" | "sheddable" }>();
  q.push({ id: 1, priority: "sheddable" });
  q.push({ id: 2, priority: "critical" });
  q.push({ id: 3, priority: "sheddable" });
  q.push({ id: 4 });
  expect(q.peekBack()?.id).toBe(2);
  expect(q.evict({ id: 5 }, false)?.id).toBe(3);
  expect(q.evict({ id: 5 }, true)?.id).toBe(1);
  expect(q.shift()?.id).toBe(2);
  expect(q.pop()?.id).toBe(4);
});

it.each(["toString", "__proto__", "constructor", "unknown", "", null, 0, {}])(
  "untrusted priority %j is rejected on import and safely treated as normal in playback",
  (priority) => {
    const d = diagram({ limit: 1 });
    d.edges[0].props!.priority = priority;
    const imported = parseNative(JSON.stringify(d));
    expect(imported.ok).toBe(false);
    if (!imported.ok) expect(imported.error).toContain("priority");
    // Internal callers can still bypass native validation: runtime lookup must fail safely too.
    const q = new ShedQueue<{ id: number; priority?: QueuePriority }>();
    q.push({ id: 1, priority: priority as QueuePriority });
    expect(q.evict({ id: 2, priority: "sheddable" }, true)).toBeUndefined();
    expect(q.evict({ id: 3, priority: "critical" }, false)?.id).toBe(1);
    const e = engine(d);
    e.inject("source", 2);
    e.step(100);
    expect(e.snapshot().nodes.worker).toMatchObject({ queueDepth: 1, shed: 1 });
    e.setNodeStatus("worker", "up");
    e.step(1000);
    expect(e.snapshot().nodes.worker.processed).toBe(1);
  },
);

it.each(["critical", "normal", "sheddable"])("accepts the allowed priority %s on import", (priority) => {
  const d = diagram();
  d.edges[0].props!.priority = priority;
  expect(parseNative(JSON.stringify(d)).ok).toBe(true);
});

it.each(["reject-new", "drop-oldest"] as const)(
  "lower-priority arrivals preserve higher-priority waiters (%s)",
  (whenFull) => {
    const d = diagram({ limit: 2, whenFull });
    d.edges[0].props!.priority = "critical";
    d.nodes.push({ ...d.nodes[0], id: "low" });
    d.edges.push({ id: "low-input", from: "low", to: "worker", props: { travelMs: 10, priority: "sheddable" } });
    const e = engine(d);
    e.inject("source", 2);
    e.step(100);
    const waiters = e
      .snapshot()
      .events.filter((v) => v.nodeId === "worker" && v.kind === "deliver")
      .map((v) => v.messageId);
    e.inject("low", 1);
    e.step(100);
    const arrival = e
      .snapshot()
      .events.find((v) => v.nodeId === "worker" && v.kind === "deliver" && !waiters.includes(v.messageId))!.messageId;
    expect(
      e
        .snapshot()
        .events.filter((v) => v.kind === "reject")
        .map((v) => v.messageId),
    ).toEqual([arrival]);
    e.setNodeStatus("worker", "up");
    e.step(1000);
    expect(
      e
        .snapshot()
        .events.filter((v) => v.nodeId === "worker" && v.kind === "process")
        .map((v) => v.messageId),
    ).toEqual(waiters);
  },
);

it("reject-new preserves equal-priority waiters", () => {
  const e = engine(diagram({ limit: 2, whenFull: "reject-new" }));
  e.inject("source", 3);
  e.step(100);
  const arrivals = e
    .snapshot()
    .events.filter((v) => v.nodeId === "worker" && v.kind === "deliver")
    .map((v) => v.messageId);
  expect(arrivals).toHaveLength(3);
  expect(
    e
      .snapshot()
      .events.filter((v) => v.kind === "reject")
      .map((v) => v.messageId),
  ).toEqual([arrivals[2]]);
  e.setNodeStatus("worker", "up");
  e.step(1000);
  expect(
    e
      .snapshot()
      .events.filter((v) => v.nodeId === "worker" && v.kind === "process")
      .map((v) => v.messageId),
  ).toEqual(arrivals.slice(0, 2));
});
it.each([2, 10])("queue grants split at scale %s, exactly at the real limit, and replay checkpoints", (scale) => {
  expect(queueGrant(0, 3, scale, true)).toBe(Math.min(scale, 3));
  const e = engine(diagram(), scale);
  e.inject("source", 4);
  e.step(100);
  const s = realSnapshot(e.snapshot()).nodes.worker;
  expect(s.backlog).toBe(3);
  expect(s.shed).toBe(4 * scale - 3);
  expect(s.rejected).toBe(s.shed);
  expect(s.rejectionReasons).toEqual({ "shed: queue full": s.shed });
  const cp = e.checkpoint();
  const drain = () => {
    e.setNodeStatus("worker", "up");
    e.step(2000);
    return e.snapshot();
  };
  const expected = drain();
  e.restore(cp);
  expect(drain()).toEqual(expected);
  expect(expected.inSystem).toBe(0);
  expect(realSnapshot(expected).nodes.worker.processed).toBe(3);
});
it.each(["fifo", "lifo"] as const)("%s lazily sheds expired waiting requests before admission", (order) => {
  const e = engine(diagram({ limit: 3, maxWaitMs: 50, order }));
  e.inject("source", 3);
  e.step(100);
  e.setNodeStatus("worker", "up");
  e.step(1000);
  expect(e.snapshot().nodes.worker).toMatchObject({
    processed: 0,
    shed: 3,
    rejectionReasons: { "shed: waited too long": 3 },
  });
  expect(e.metrics().inSystem).toBe(0);
});
it("a whole shed returns 503 throttled and is eligible for a throttled-only retry", () => {
  const d = diagram({ limit: 1 }, true);
  (d.edges[0].props!.caller as { retry: { maxAttempts: number } }).retry.maxAttempts = 2;
  const e = engine(d);
  e.inject("source", 3);
  e.step(100);
  expect(e.snapshot().nodes.worker.shed).toBeGreaterThanOrEqual(2);
  expect(e.snapshot().edges.input.calls!.retried).toBeGreaterThan(0);
  expect(
    e
      .snapshot()
      .events.filter((event) => event.kind === "reject")
      .every((event) => event.text.includes("shed:")),
  ).toBe(true);
});
it("work that starts immediately does not consume queue room", () => {
  const d = diagram({ limit: 1 });
  d.nodes[1].props!.status = "up";
  d.nodes[1].props!.concurrency = 4;
  const e = engine(d);
  e.inject("source", 4);
  e.step(50);
  expect(e.snapshot().nodes.worker).toMatchObject({ shed: 0, backlog: 0, inFlight: 4 });
});
it("broker deliveries are never shed by a consumer queue policy", () => {
  const d = diagram({ limit: 1, maxWaitMs: 0 });
  d.nodes[0].stencil = "generic.queue";
  const e = engine(d);
  e.inject("source", 5);
  e.step(100);
  e.setNodeStatus("worker", "up");
  e.step(3000);
  expect(e.snapshot().nodes.worker).toMatchObject({ shed: 0, processed: 5 });
  expect(e.metrics().inSystem).toBe(0);
});
it("queue fields stay dormant below W2 and on managed APIs", () => {
  const d = diagram({ limit: 1 });
  d.planning!.revision = "p3-w1";
  const e = engine(d);
  e.inject("source", 4);
  e.step(100);
  expect(e.snapshot().nodes.worker.backlog).toBe(4);
  expect(e.snapshot().nodes.worker.shed).toBeUndefined();
  d.planning!.revision = "p3-w2";
  d.nodes[1].stencil = "aws.lambda";
  const managed = engine(d);
  expect(managed.snapshot().nodes.worker.shed).toBeUndefined();
});
it("validates queue fields with strict bounded nested properties", () => {
  expect(
    propsProblem({ queue: { limit: 60, order: "lifo", whenFull: "drop-oldest", maxWaitMs: 200 } }),
  ).toBeUndefined();
  for (const queue of [
    { limit: 0 },
    { limit: 1000001 },
    { limit: 1.5 },
    { maxWaitMs: -1 },
    { order: "random" },
    { extra: true },
  ])
    expect(propsProblem({ queue })).toBeDefined();
});

it.each([2, 10])("drop-oldest evicts only the required partial dot at scale %s", (scale) => {
  const e = engine(diagram({ limit: scale + 1, whenFull: "drop-oldest" }), scale);
  e.inject("source", 3);
  e.step(100);
  const n = realSnapshot(e.snapshot()).nodes.worker;
  expect(n.queueDepth).toBe(scale + 1);
  expect(n.shed).toBe(2 * scale - 1);
  e.setNodeStatus("worker", "up");
  e.step(5000);
  expect(realSnapshot(e.snapshot()).nodes.worker.processed).toBe(scale + 1);
});
it.each(["fifo", "lifo"] as const)("%s serves the expected waiting message first", (order) => {
  const e = engine(diagram({ limit: 3, order }));
  e.inject("source", 3);
  e.step(100);
  e.setNodeStatus("worker", "up");
  e.step(10);
  const trace = e.snapshot().events.filter((event) => event.nodeId === "worker" && event.kind === "deliver");
  expect(trace).toHaveLength(3);
  // Trace history records actual start ownership; use the engine's source ids, not visual timing.
  e.step(1000);
  const done = e.snapshot().events.filter((event) => event.nodeId === "worker" && event.kind === "process");
  expect(done.map((e) => e.messageId)).toEqual(
    order === "fifo" ? trace.map((e) => e.messageId) : trace.map((e) => e.messageId).reverse(),
  );
});

it("the test event observer retains overflow while the UI event ring stays bounded", () => {
  const e = engine(diagram({ limit: 1 }));
  const events: import("./types").SimEvent[] = [];
  const stop = observeEngineEvents(e, (event) => events.push(event));
  e.inject("source", 150);
  e.step(100);
  expect(events.length).toBeGreaterThan(200);
  expect(e.snapshot().events).toEqual(events.slice(-200));
  stop();
  const count = events.length;
  e.step(100);
  expect(events).toHaveLength(count);
});

it("enabling, shrinking and removing a live queue policy reconciles existing waiting requests", () => {
  const d = diagram();
  delete d.nodes[1].props!.queue;
  const e = engine(d);
  e.inject("source", 6);
  e.step(100);
  e.setNodeProps("worker", { queue: { limit: 4 } });
  e.step(10);
  expect(e.snapshot().nodes.worker).toMatchObject({ queueDepth: 4, shed: 2, backlog: 4 });
  e.setNodeProps("worker", { queue: { limit: 2, order: "lifo" } });
  e.step(10);
  expect(e.snapshot().nodes.worker).toMatchObject({ queueDepth: 2, shed: 4 });
  e.setNodeProps("worker", { queue: undefined });
  e.step(10);
  expect(e.snapshot().nodes.worker.shed).toBe(4);
  e.setNodeStatus("worker", "up");
  e.step(2000);
  expect(e.snapshot().nodes.worker.processed).toBe(2);
});

it("a live sampling edit never resizes requests already resident in the shed queue", () => {
  const e = engine(diagram({ limit: 3 }), 2);
  e.inject("source", 2);
  e.step(100);
  expect(realSnapshot(e.snapshot()).nodes.worker.queueDepth).toBe(3);
  e.setScale(10);
  e.step(10);
  expect(realSnapshot(e.snapshot()).nodes.worker.queueDepth).toBe(3);
  e.setNodeStatus("worker", "up");
  e.step(3000);
  expect(realSnapshot(e.snapshot()).nodes.worker.processed).toBe(3);
});

it("resource recovery keeps already-started work out of maximum-wait shedding", () => {
  const d = diagram({ limit: 1, maxWaitMs: 1 });
  d.nodes[1].props!.status = "up";
  d.nodes[1].props!.latencyMs = 1000;
  const e = engine(d);
  e.inject("source", 1);
  e.step(100);
  expect(e.snapshot().nodes.worker.inFlight).toBeGreaterThan(0);
  e.setNodeProps("worker", {
    resources: { ...resourceLesson(), cpuMsPerMessage: 0, startup: { delayMs: 1000, jitterFraction: 0 } },
  });
  e.step(3000);
  expect(e.snapshot().nodes.worker.shed).toBe(0);
  expect(e.snapshot().nodes.worker.processed).toBe(1);
});

it("a critical arrival evicts the newest lowest-priority waiter and is served first", () => {
  const d = diagram({ limit: 2 });
  d.nodes.push({ ...d.nodes[0], id: "critical" });
  d.edges.push({ id: "critical-input", from: "critical", to: "worker", props: { travelMs: 10, priority: "critical" } });
  const e = engine(d);
  e.inject("source", 2);
  e.step(100);
  const normal = e
    .snapshot()
    .events.filter((event) => event.nodeId === "worker" && event.kind === "deliver")
    .map((event) => event.messageId);
  e.inject("critical", 1);
  e.step(100);
  expect(e.snapshot().nodes.worker).toMatchObject({ queueDepth: 2, shed: 1 });
  expect(e.snapshot().events.find((event) => event.kind === "reject")?.messageId).toBe(normal[1]);
  const critical = e
    .snapshot()
    .events.filter((event) => event.nodeId === "worker" && event.kind === "deliver")
    .at(-1)!.messageId;
  e.setNodeStatus("worker", "up");
  e.step(1000);
  expect(
    e
      .snapshot()
      .events.filter((event) => event.nodeId === "worker" && event.kind === "process")
      .map((event) => event.messageId),
  ).toEqual([critical, normal[0]]);
});
it.each([2, 10])("a partial shed Request settles only its retained branch at scale %s", (scale) => {
  const e = engine(diagram({ limit: 1 }, true), scale);
  e.inject("source", 1);
  e.step(100);
  expect(realSnapshot(e.snapshot()).nodes.worker.shed).toBe(scale - 1);
  e.setNodeStatus("worker", "up");
  e.step(2000);
  const snapshot = realSnapshot(e.snapshot());
  expect(snapshot.edges.input.calls).toMatchObject({ failed: scale - 1, succeeded: 1, inFlight: 0 });
  expect(snapshot.inSystem).toBe(0);
});

it("R4 independently recounts only changed queues, without rescanning idle ticks", () => {
  const e = createEngine({ maxParticles: 0, verifyResilience: assertResilienceInvariants });
  e.load(diagram({ limit: 3 }));
  e.inject("source", 3);
  e.step(100);
  const iterate = vi.spyOn(ShedQueue.prototype, Symbol.iterator);
  try {
    e.step(1000);
    expect(iterate).not.toHaveBeenCalled();
    e.setNodeStatus("worker", "up");
    e.step(1000);
    expect(iterate).toHaveBeenCalled();
    expect(e.snapshot().nodes.worker.processed).toBe(3);
  } finally {
    iterate.mockRestore();
  }
});
