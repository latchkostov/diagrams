import { describe, expect, it } from "vitest";
import type { DiagramEdge, DiagramFile, DiagramNode, SimRole } from "../model/types";
import { createEngine } from "./engine";
import { MAX_STEPS } from "./lineage";
import { createSimulationRun } from "./simulation";
import type { EngineOptions, MessageTrace, SimEngine, TraceStep } from "./types";

const node = (id: string, role: SimRole, props: Record<string, unknown> = {}): DiagramNode => ({
  id,
  stencil: role,
  label: id,
  x: 0,
  y: 0,
  props: { jitter: 0, ...props },
});
const edge = (from: string, to: string, props: Record<string, unknown> = {}, kind?: "sync"): DiagramEdge => ({
  id: `${from}-${to}`,
  from,
  to,
  ...(kind ? { kind } : {}),
  props: { travelMs: 20, ...props },
});
const diagram = (nodes: DiagramNode[], edges: DiagramEdge[]): DiagramFile => ({
  format: "diagrams/v1",
  title: "Lineage",
  nodes,
  edges,
});
function engine(d: DiagramFile, opts: EngineOptions = {}): SimEngine {
  const e = createEngine({ seed: 42, roleOf: (id) => id as SimRole, ...opts });
  e.load(d);
  return e;
}
function run(e: SimEngine, ms = 5000): void {
  for (let t = 0; t < ms; t += 10) e.step(10);
}
const kinds = (trace: MessageTrace | undefined) => trace?.steps.map((s) => s.kind) ?? [];
const where = (trace: MessageTrace | undefined, kind: TraceStep["kind"]) =>
  trace?.steps.filter((s) => s.kind === kind) ?? [];

const pipeline = diagram(
  [node("src", "source"), node("work", "processor", { latencyMs: 100 }), node("out", "sink")],
  [edge("src", "work", { travelMs: 50 }), edge("work", "out", { travelMs: 30 })],
);

const fanout = diagram(
  [
    node("src", "source"),
    node("topic", "topic"),
    node("a", "processor", { latencyMs: 40 }),
    node("b", "processor", { latencyMs: 60 }),
    node("c", "processor", { latencyMs: 80, emits: "Audited" }),
    node("db", "store", { latencyMs: 10 }),
  ],
  [edge("src", "topic"), edge("topic", "a"), edge("topic", "b"), edge("topic", "c"), edge("a", "db", {}, "sync")],
);

const poison = diagram(
  [
    node("q", "queue", { maxDeliveryCount: 3 }),
    node("worker", "processor", { latencyMs: 30, failureRate: 1 }),
    node("dlq", "queue"),
  ],
  [edge("q", "worker"), edge("q", "dlq", { dlq: true })],
);

describe("message lineage: recording", () => {
  it("records a linear journey hop by hop, with times, and finishes when the message is consumed", () => {
    const e = engine(pipeline);
    e.tracer.request({ next: "message", node: "src" });
    e.inject("src", 1);
    expect(e.tracer.followed()).toBe(1);
    run(e, 1000);
    const trace = e.tracer.current()!;
    expect(kinds(trace)).toEqual(["emit", "done", "send", "arrive", "start", "done", "send", "arrive", "done", "end"]);
    expect(trace).toMatchObject({ rootId: 1, origin: "src", type: "src", done: true, partial: false });
    const [send] = where(trace, "send");
    const [arrive] = where(trace, "arrive");
    expect(send).toMatchObject({ node: "src", edge: "src-work", via: "message" });
    expect(arrive.t).toBe(send.until);
    expect(arrive.t - send.t).toBe(50);
    const [start] = where(trace, "start");
    const done = where(trace, "done").find((s) => s.node === "work")!;
    expect(done.t - start.t).toBeGreaterThanOrEqual(100);
    expect(trace.endedAt! - trace.startedAt).toBeGreaterThanOrEqual(50 + 100 + 30);
    expect(where(trace, "end")[0]).toMatchObject({ node: "out", reason: "received" });
  });

  it("gives fan-out copies new ids in the same family, and records every branch from the root", () => {
    const e = engine(fanout);
    e.tracer.request({ next: "message" });
    e.inject("src", 1);
    run(e, 30);
    const particles = e.frame().particles;
    expect(new Set(particles.map((p) => p.rootId))).toEqual(new Set([1]));
    run(e, 2000);
    const trace = e.tracer.current()!;
    const copies = where(trace, "copy");
    expect(copies).toHaveLength(2);
    expect(copies.every((c) => c.parent === 1 && c.node === "topic")).toBe(true);
    const ids = new Set(trace.steps.map((s) => s.id));
    expect(ids.size).toBe(3);
    const reached = new Set(where(trace, "arrive").map((s) => s.node));
    expect(reached).toEqual(new Set(["topic", "a", "b", "c", "db"]));
    expect(trace.done).toBe(true);
    // Every copy that reaches a consumer ends somewhere (or replies on its sync edge).
    expect(where(trace, "end").length).toBe(3);
  });

  it("records renames, sync replies and the time spent in each node", () => {
    const e = engine(fanout);
    e.tracer.request({ next: "message" });
    e.inject("src", 1);
    run(e, 2000);
    const trace = e.tracer.current()!;
    const audited = trace.steps.find((s) => s.kind === "send" && s.node === "c");
    expect(audited).toBeUndefined(); // c has no outgoing edge: it consumes the message
    expect(where(trace, "end").find((s) => s.node === "c")?.type).toBe("Audited");
    const reply = where(trace, "send").find((s) => s.via === "reply");
    expect(reply).toMatchObject({ edge: "a-db", node: "db" });
  });

  it("records failed deliveries, retries and the dead letter, then finishes when the DLQ parks it", () => {
    const e = engine(poison);
    e.tracer.request({ next: "message", node: "q" });
    e.inject("q", 1);
    run(e, 3000);
    const trace = e.tracer.current()!;
    expect(where(trace, "fail").map((s) => s.attempt)).toEqual([1, 2, 3]);
    expect(where(trace, "retry").map((s) => s.attempt)).toEqual([1, 2]);
    expect(where(trace, "deadletter")).toEqual([expect.objectContaining({ node: "q", attempt: 3 })]);
    expect(where(trace, "send").at(-1)).toMatchObject({ edge: "q-dlq", via: "dlq" });
    expect(kinds(trace).at(-1)).toBe("park");
    expect(trace.done).toBe(true);
    expect(e.tracer.recent()).toEqual([
      expect.objectContaining({ rootId: 1, retries: 2, deadLettered: true, dropped: false, done: true }),
    ]);
  });

  it("records a drop at a node that's down", () => {
    const e = engine(pipeline);
    e.setNodeStatus("work", "down");
    e.tracer.request({ next: "message" });
    e.inject("src", 1);
    run(e, 500);
    const trace = e.tracer.current()!;
    expect(kinds(trace).at(-1)).toBe("drop");
    expect(where(trace, "drop")[0]).toMatchObject({ node: "work", reason: "node down" });
    expect(trace.done).toBe(true);
    expect(e.tracer.recent()[0].dropped).toBe(true);
  });
});

describe("message lineage: choosing what to follow", () => {
  it("records nothing until asked (history 0), and nothing changes in the run", () => {
    const plain = engine(fanout),
      traced = engine(fanout);
    traced.tracer.setHistory(50);
    traced.tracer.request({ next: "message", node: "b" });
    for (const e of [plain, traced]) {
      e.setTraffic(true);
      run(e, 4000);
    }
    expect(plain.tracer.recent()).toEqual([]);
    expect(traced.tracer.recent().length).toBeGreaterThan(0);
    expect(traced.snapshot()).toEqual(plain.snapshot());
  });

  it("follows the next message to arrive at a node, with its earlier hops when history keeps them", () => {
    const e = engine(pipeline);
    e.tracer.setHistory(10);
    e.inject("src", 1);
    e.tracer.request({ next: "message", node: "work" });
    expect(e.tracer.pending()).toEqual({ next: "message", node: "work" });
    run(e, 1000);
    const trace = e.tracer.current()!;
    expect(trace.partial).toBe(false);
    expect(kinds(trace)[0]).toBe("emit");
    expect(e.tracer.pending()).toBeUndefined();
  });

  it("starts a partial trace from where the message is when there's no history", () => {
    const e = engine(pipeline);
    e.inject("src", 1);
    e.tracer.request({ next: "message", node: "work" });
    run(e, 1000);
    const trace = e.tracer.current()!;
    expect(trace.partial).toBe(true);
    expect(trace.origin).toBe("work");
    expect(kinds(trace)[0]).toBe("arrive");
    expect(trace.done).toBe(true);
  });

  it("follows a clicked particle by its message id, copies included", () => {
    const e = engine(fanout);
    e.tracer.setHistory(10);
    e.inject("src", 1);
    run(e, 30);
    const copy = e.frame().particles.find((p) => p.messageId !== p.rootId)!;
    expect(copy).toBeDefined();
    expect(e.tracer.follow(copy.messageId)).toBe(1);
    expect(e.tracer.current()?.partial).toBe(false);
    expect(e.tracer.follow(9999)).toBeUndefined();
  });

  it("follows the next dead letter", () => {
    const e = engine(poison);
    e.tracer.setHistory(10);
    e.tracer.request({ next: "deadletter" });
    e.inject("q", 3, { spreadMs: 200 });
    run(e, 4000);
    const trace = e.tracer.current()!;
    expect(where(trace, "deadletter")).toHaveLength(1);
    expect(trace.rootId).toBe(1);
    expect(trace.partial).toBe(false);
  });

  it("follows a root that doesn't exist yet as soon as it's created", () => {
    const e = engine(pipeline);
    e.tracer.followRoot(3);
    expect(e.tracer.followed()).toBe(3);
    e.inject("src", 4, { spreadMs: 300 });
    run(e, 2000);
    expect(e.tracer.current()?.rootId).toBe(3);
    expect(e.tracer.current()?.partial).toBe(false);
  });

  it("clear() stops following; load() forgets everything but keeps the history size", () => {
    const e = engine(pipeline);
    e.tracer.setHistory(5);
    e.tracer.request({ next: "message" });
    e.inject("src", 2);
    run(e, 1000);
    e.tracer.clear();
    expect(e.tracer.followed()).toBeUndefined();
    expect(e.tracer.recent()).toHaveLength(2);
    e.load(pipeline);
    expect(e.tracer.recent()).toEqual([]);
    e.inject("src", 1);
    run(e, 1000);
    expect(e.tracer.recent()).toHaveLength(1);
  });
});

describe("message lineage: memory and determinism", () => {
  it("keeps at most `history` recordings, evicting the oldest finished ones", () => {
    const e = engine(pipeline);
    e.tracer.setHistory(5);
    e.inject("src", 40, { spreadMs: 2000 });
    run(e, 4000);
    const recent = e.tracer.recent();
    expect(recent.length).toBe(5);
    expect(recent.map((r) => r.rootId)).toEqual([36, 37, 38, 39, 40]);
    e.tracer.setHistory(2);
    expect(e.tracer.recent().map((r) => r.rootId)).toEqual([39, 40]);
  });

  it("stops sampling new messages while every slot holds one still in flight (slow ones survive)", () => {
    const e = engine(pipeline);
    e.setNodeStatus("work", "paused");
    e.tracer.setHistory(3);
    e.inject("src", 10);
    run(e, 500);
    expect(e.tracer.recent().map((r) => r.rootId)).toEqual([1, 2, 3]);
    e.setNodeStatus("work", "up");
    run(e, 3000);
    expect(e.tracer.recent().every((r) => r.done)).toBe(true);
  });

  it("never keeps more than MAX_STEPS steps for one family (a feedback loop)", () => {
    const e = engine(
      diagram(
        [node("a", "none"), node("b", "none")],
        [edge("a", "b", { travelMs: 10 }), edge("b", "a", { travelMs: 10 })],
      ),
    );
    e.tracer.request({ next: "message" });
    e.inject("a", 1);
    run(e, 20_000);
    const trace = e.tracer.current()!;
    expect(trace.steps).toHaveLength(MAX_STEPS);
    expect(trace.truncated).toBe(true);
    expect(trace.done).toBe(false);
  });

  it("is deterministic for a seed: the same messages, ids and times", () => {
    const traces = [1, 2].map(() => {
      const e = engine(
        diagram(
          [
            node("src", "source", { ratePerSec: 20 }),
            node("topic", "topic"),
            node("a", "processor", { latencyMs: 40, jitter: 0.5, failureRate: 0.3 }),
            node("b", "processor", { latencyMs: 60, jitter: 0.5 }),
            node("dlq", "queue"),
          ],
          [edge("src", "topic"), edge("topic", "a"), edge("topic", "b"), edge("topic", "dlq", { dlq: true })],
        ),
      );
      e.tracer.setHistory(20);
      e.setTraffic(true);
      run(e, 5000);
      return e.tracer.recent().map((r) => e.tracer.get(r.rootId));
    });
    expect(traces[0].length).toBeGreaterThan(5);
    expect(traces[1]).toEqual(traces[0]);
  });

  it("checkpoints capture recordings and what's followed; restoring replays identically", () => {
    const e = engine(poison);
    e.tracer.setHistory(10);
    e.inject("q", 4, { spreadMs: 400 });
    run(e, 200);
    e.tracer.follow(e.frame().particles[0].messageId);
    const followed = e.tracer.followed();
    const before = e.tracer.current();
    const checkpoint = e.checkpoint();
    run(e, 3000);
    const after = { current: e.tracer.current(), recent: e.tracer.recent() };
    e.tracer.clear();
    e.tracer.request({ next: "deadletter" });
    e.restore(checkpoint);
    expect(e.tracer.followed()).toBe(followed);
    expect(e.tracer.pending()).toBeUndefined();
    expect(e.tracer.current()).toEqual(before);
    run(e, 3000);
    expect({ current: e.tracer.current(), recent: e.tracer.recent() }).toEqual(after);
  });

  it("a saved simulation's trace timeline action follows the next message at its node", () => {
    const d = { ...pipeline };
    const run = createSimulationRun(
      d,
      {
        id: "s",
        title: "Trace",
        traffic: [{ id: "t", node: "src", shape: { kind: "burst", count: 3, spreadMs: 300 } }],
        timeline: [{ atMs: 120, action: { do: "trace", node: "work" } }],
      },
      { roleOf: (id) => id as SimRole },
    );
    expect(run.state().markers.some((m) => m.kind === "trace")).toBe(true);
    for (let t = 0; t < 3000; t += 10) run.step(10);
    const trace = run.engine.tracer.current()!;
    expect(trace.rootId).toBe(2);
    expect(where(trace, "arrive")[0].node).toBe("work");
  });
});
