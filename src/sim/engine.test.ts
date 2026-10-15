import { describe, expect, it } from "vitest";
import type { DiagramEdge, DiagramFile, DiagramNode, SimRole } from "../model/types";
import { getStencil } from "../stencils/registry";
import { SOURCE_RATE_CAP, SOURCE_VOLUME_CAP, createEngine } from "./engine";
import { messageColor, MESSAGE_PALETTE } from "./colors";
import type { EngineOptions, SimEngine } from "./types";

const node = (id: string, role: SimRole, props: Record<string, unknown> = {}): DiagramNode => ({
  id,
  stencil: role,
  label: id,
  x: 0,
  y: 0,
  props: { jitter: 0, ...props },
});
const edge = (from: string, to: string, props: Record<string, unknown> = {}, id = `${from}-${to}`): DiagramEdge => ({
  id,
  from,
  to,
  props: { travelMs: 20, ...props },
});
const diagram = (nodes: DiagramNode[], edges: DiagramEdge[]): DiagramFile => ({
  format: "diagrams/v1",
  title: "Test",
  nodes,
  edges,
});
function engine(nodes: DiagramNode[], edges: DiagramEdge[], opts: EngineOptions = {}): SimEngine {
  const result = createEngine({ seed: 42, roleOf: (id) => id as SimRole, ...opts });
  result.load(diagram(nodes, edges));
  return result;
}
function run(sim: SimEngine, duration = 5000): void {
  for (let elapsed = 0; elapsed < duration; elapsed += 10) sim.step(Math.min(10, duration - elapsed));
}
function broker(role: SimRole = "queue", props = {}, edgeProps = {}) {
  return engine(
    [node("b", role, props), node("c", "processor", { latencyMs: 20 }), node("end", "sink"), node("dlq", "sink")],
    [edge("b", "c", edgeProps), edge("c", "end"), edge("b", "dlq", { dlq: true })],
  );
}

describe("typed messages", () => {
  it.each(["source", "processor", "none", "store"] as const)(
    "%s filters sync and async routes using exact and trailing wildcard matches",
    (role) => {
      const sim = engine(
        [node("s", role), node("a", "sink"), node("b", "sink"), node("c", "sink")],
        [
          edge("s", "a", { filter: ["Order*"] }),
          edge("s", "b", { filter: ["OrderPlaced"] }),
          { ...edge("s", "c", { filter: ["Order", "O*Placed"] }), kind: "sync" },
        ],
      );
      sim.inject("s", 3, { type: "OrderPlaced" });
      sim.inject("s", 2, { type: "OrderRefunded" });
      sim.inject("s", 1, { type: "Invoice" });
      run(sim);
      expect(sim.snapshot().nodes.a.processed).toBe(5);
      expect(sim.snapshot().nodes.b.processed).toBe(3);
      expect(sim.snapshot().nodes.c.processed).toBe(0);
      expect(sim.snapshot().inSystem).toBe(0);
    },
  );

  it("sync edges filter requests and permit their replies", () => {
    const sim = engine(
      [node("s", "source"), node("a", "store")],
      [{ ...edge("s", "a", { filter: ["Order*"] }), kind: "sync" }],
    );
    sim.inject("s", 1, { type: "Invoice" });
    sim.inject("s", 1, { type: "OrderPlaced" });
    sim.step(70);
    expect(sim.snapshot().particles.some((p) => p.kind === "reply")).toBe(true);
    run(sim);
    expect(sim.snapshot().nodes.a.processed).toBe(1);
  });

  it("gateways round-robin only among accepting edges", () => {
    const sim = engine(
      [node("g", "gateway"), node("a", "sink"), node("b", "sink"), node("c", "sink")],
      [
        edge("g", "a", { filter: ["Order*"] }),
        edge("g", "b", { filter: ["Invoice"] }),
        edge("g", "c", { filter: ["*"] }),
      ],
    );
    sim.inject("g", 10, { type: "OrderPlaced" });
    run(sim);
    expect(sim.snapshot().nodes.a.processed).toBe(5);
    expect(sim.snapshot().nodes.b.processed).toBe(0);
    expect(sim.snapshot().nodes.c.processed).toBe(5);
  });

  it.each(["topic", "stream", "queue"] as const)(
    "%s counts only accepted messages in lag and routes to accepting group members",
    (role) => {
      const sim = engine(
        [
          node("b", role),
          node("a", "processor", { status: "paused" }),
          node("c", "processor", { status: "paused" }),
          node("d", "sink"),
        ],
        [
          edge("b", "a", { group: "shared", filter: ["Order*"] }),
          edge("b", "c", { group: "shared", filter: ["Invoice"] }),
          edge("b", "d", { group: "reject", filter: [] }),
        ],
      );
      sim.inject("b", 7, { type: "OrderPlaced" });
      sim.inject("b", 4, { type: "Invoice" });
      sim.inject("b", 9, { type: "Other" });
      expect(sim.snapshot().nodes.b.lag).toEqual(role === "queue" ? { queue: 11 } : { shared: 11, reject: 0 });
      expect(sim.snapshot().inSystem).toBe(11);
      sim.setNodeStatus("a", "up");
      sim.setNodeStatus("c", "up");
      run(sim);
      expect(sim.snapshot().nodes.a.processed).toBe(7);
      expect(sim.snapshot().nodes.c.processed).toBe(4);
      expect(sim.snapshot().nodes.d.processed).toBe(0);
      expect(sim.snapshot().inSystem).toBe(0);
    },
  );

  it.each(["processor", "none"] as const)(
    "%s emits a string, exact map entry, fallback, or unchanged type with matching colours",
    (role) => {
      for (const [emits, incoming, outgoing] of [
        ["PaymentCompleted", "OrderPlaced", "PaymentCompleted"],
        [{ OrderPlaced: "PaymentCompleted", "*": "AuditLogged" }, "OrderPlaced", "PaymentCompleted"],
        [{ OrderPlaced: "PaymentCompleted", "*": "AuditLogged" }, "Other", "AuditLogged"],
        [{ OrderPlaced: "PaymentCompleted" }, "Other", "Other"],
      ] as const) {
        const sim = engine(
          [node("p", role, { emits, latencyMs: 0 }), node("s", "sink")],
          [edge("p", "s", { travelMs: 500 })],
        );
        sim.inject("p", 1, { type: incoming });
        sim.step(10);
        expect(sim.snapshot().particles[0]).toMatchObject({ type: outgoing, color: messageColor(outgoing) });
      }
    },
  );

  it("edge emits overrides node emits after filtering, independently per edge", () => {
    const sim = engine(
      [node("p", "processor", { emits: "PaymentCompleted", latencyMs: 0 }), node("a", "sink"), node("b", "sink")],
      [edge("p", "a", { filter: ["Payment*"], emits: "AuditLogged" }), edge("p", "b", { filter: ["Payment*"] })],
    );
    sim.inject("p", 1, { type: "OrderPlaced" });
    sim.step(10);
    expect(sim.snapshot().particles.map((p) => p.type)).toEqual(["AuditLogged", "PaymentCompleted"]);
  });

  it("broker retries retain the original type for filters despite edge renaming", () => {
    const sim = engine(
      [node("b", "queue"), node("p", "processor", { latencyMs: 0, failureRate: 1 }), node("dlq", "sink")],
      [
        edge("b", "p", { filter: ["Order*"], emits: "Command" }),
        edge("b", "dlq", { dlq: true, filter: ["Order*"], emits: "PoisonOrder" }),
      ],
    );
    sim.inject("b", 2, { type: "OrderPlaced" });
    run(sim);
    expect(sim.snapshot().nodes.p.failed).toBe(6);
    expect(sim.snapshot().nodes.b.deadLettered).toBe(2);
    expect(sim.snapshot().nodes.dlq.processed).toBe(2);
    expect(sim.snapshot().inSystem).toBe(0);
  });

  it("a rejected DLQ edge drops a failed message without sending it", () => {
    const sim = engine(
      [node("b", "queue", { maxDeliveryCount: 1 }), node("p", "processor", { failureRate: 1 }), node("dlq", "sink")],
      [edge("b", "p"), edge("b", "dlq", { dlq: true, filter: [] })],
    );
    sim.inject("b", 1);
    run(sim);
    expect(sim.snapshot().nodes.b.dropped).toBe(1);
    expect(sim.snapshot().nodes.dlq.processed).toBe(0);
  });
});

describe("message routing", () => {
  it("sources fan out to every edge, including a named DLQ target", () => {
    const sim = engine(
      [node("s", "source"), node("a", "sink"), node("dlq", "sink")],
      [edge("s", "a"), edge("s", "dlq")],
    );
    sim.inject("s", 12, { type: "OrderPlaced" });
    expect(sim.snapshot().inSystem).toBe(24);
    expect(sim.snapshot().particles.every((p) => p.type === "OrderPlaced")).toBe(true);
    run(sim);
    expect(sim.snapshot().nodes.a.processed).toBe(12);
    expect(sim.snapshot().nodes.dlq.processed).toBe(12);
    expect(sim.snapshot().inSystem).toBe(0);
  });

  it.each(["topic", "stream"] as const)("%s delivers every message to each group", (role) => {
    const sim = engine(
      [node("b", role), node("a", "sink"), node("c", "sink")],
      [edge("b", "a", { group: "alpha" }), edge("b", "c", { group: "beta" })],
    );
    sim.inject("b", 17);
    expect(sim.snapshot().nodes.b.lag).toEqual({ alpha: 17, beta: 17 });
    run(sim);
    expect(sim.snapshot().nodes.a.processed).toBe(17);
    expect(sim.snapshot().nodes.c.processed).toBe(17);
    expect(sim.snapshot().inSystem).toBe(0);
  });

  it("default topic groups use edge ids, ignoring node props.group", () => {
    const sim = engine(
      [node("b", "topic"), node("a", "sink", { group: "shared" }), node("c", "sink", { group: "shared" })],
      [edge("b", "a"), edge("b", "c")],
    );
    sim.inject("b", 7);
    expect(sim.snapshot().nodes.b.lag).toEqual({ "b-a": 7, "b-c": 7 });
    run(sim);
    expect(sim.snapshot().nodes.a.processed + sim.snapshot().nodes.c.processed).toBe(14);
  });

  it.each(["topic", "stream", "queue"] as const)("%s consumers compete fairly", (role) => {
    const sim = engine(
      [node("b", role), node("a", "processor", { latencyMs: 10 }), node("c", "processor", { latencyMs: 10 })],
      [edge("b", "a", { group: "shared" }), edge("b", "c", { group: "shared" })],
    );
    sim.inject("b", 31);
    run(sim);
    const { a, c } = sim.snapshot().nodes;
    expect(a.processed + c.processed).toBe(31);
    expect(Math.abs(a.processed - c.processed)).toBeLessThanOrEqual(1);
    expect(a.processed).toBeGreaterThan(0);
    expect(c.processed).toBeGreaterThan(0);
  });

  it("queue competition ignores distinct edge groups", () => {
    const sim = engine(
      [node("q", "queue"), node("a", "sink"), node("b", "sink")],
      [edge("q", "a", { group: "a" }), edge("q", "b", { group: "b" })],
    );
    sim.inject("q", 20);
    run(sim);
    expect(sim.snapshot().nodes.a.processed + sim.snapshot().nodes.b.processed).toBe(20);
  });

  it("gateways route round-robin without a concurrency limit", () => {
    const sim = engine(
      [node("g", "gateway", { latencyMs: 20, concurrency: 1 }), node("a", "sink"), node("b", "sink")],
      [edge("g", "a"), edge("g", "b")],
    );
    sim.inject("g", 10);
    sim.step(10);
    expect(sim.snapshot().nodes.g.inFlight).toBe(10);
    run(sim);
    expect(sim.snapshot().nodes.a.processed).toBe(5);
    expect(sim.snapshot().nodes.b.processed).toBe(5);
  });

  it("gateway round-robin includes every outgoing edge", () => {
    const sim = engine(
      [node("g", "gateway"), node("a", "sink"), node("dlq", "sink")],
      [edge("g", "a"), edge("g", "dlq")],
    );
    sim.inject("g", 6);
    run(sim);
    expect(sim.snapshot().nodes.a.processed).toBe(3);
    expect(sim.snapshot().nodes.dlq.processed).toBe(3);
  });

  it("none passes through; processors fan out but exclude DLQ paths", () => {
    const sim = engine(
      [
        node("n", "none"),
        node("p", "processor", { latencyMs: 0 }),
        node("a", "sink"),
        node("b", "sink"),
        node("dlq", "sink"),
      ],
      [edge("n", "p"), edge("p", "a"), edge("p", "b"), edge("p", "dlq", { dlq: true })],
    );
    sim.inject("n", 5);
    run(sim);
    expect(sim.snapshot().nodes.a.processed).toBe(5);
    expect(sim.snapshot().nodes.b.processed).toBe(5);
    expect(sim.snapshot().nodes.dlq.processed).toBe(0);
  });

  it.each([
    ["store", "sync"],
    ["sink", "async"],
  ] as const)("%s is terminal even with outgoing %s edges", (role, kind) => {
    const sim = engine(
      [node("s", "source"), node("t", role), node("end", "sink")],
      [edge("s", "t"), { ...edge("t", "end"), kind }],
    );
    sim.inject("s", 3);
    run(sim);
    expect(sim.snapshot().nodes.t.processed).toBe(3);
    expect(sim.snapshot().nodes.end.processed).toBe(0);
    expect(sim.snapshot().inSystem).toBe(0);
  });
});

describe("pull capacity and status", () => {
  it("partition caps limit each group's work; a small pipeline travels ahead and waits at the consumer", () => {
    const sim = engine(
      [
        node("b", "topic", { partitions: 2 }),
        node("a", "processor", { replicas: 10, concurrency: 1, latencyMs: 500 }),
        node("c", "processor", { replicas: 10, concurrency: 1, latencyMs: 500 }),
      ],
      [edge("b", "a", { group: "one", travelMs: 100 }), edge("b", "c", { group: "two", travelMs: 100 })],
    );
    sim.inject("b", 20);
    sim.step(10);
    // Per group: 2 partition slots + ceil(2 × 100 / 500) on the way + a prefetch of 1.
    expect(sim.snapshot().particles).toHaveLength(8);
    sim.step(200);
    const snap = sim.snapshot();
    expect(snap.nodes.a.inFlight).toBe(2);
    expect(snap.nodes.c.inFlight).toBe(2);
    expect(snap.nodes.a.backlog).toBe(2);
    expect(snap.edges["b-a"].delivered).toBe(4);
    expect(snap.nodes.b.lag).toEqual({ one: 16, two: 16 });
    run(sim, 10000);
    expect(sim.snapshot().nodes.a.processed).toBe(20);
  });

  it("shares a consumer's pipeline across different brokers", () => {
    const sim = engine(
      [node("q", "queue"), node("r", "queue"), node("c", "processor", { concurrency: 2, latencyMs: 100 })],
      [edge("q", "c", { travelMs: 100 }), edge("r", "c", { travelMs: 100 })],
    );
    sim.inject("q", 8);
    sim.inject("r", 8);
    sim.step(10);
    // 2 slots + ceil(2 × 100 / 100) on the way + 1, all taken by the first broker: the second sends none.
    expect(sim.snapshot().particles).toHaveLength(5);
    expect(sim.snapshot().edges["r-c"].active).toBe(0);
    sim.step(100);
    expect(sim.snapshot().nodes.c.inFlight).toBe(2);
    run(sim);
    expect(sim.snapshot().nodes.c.processed).toBe(16);
  });

  it("paused consumers grow broker lag and resume drains it", () => {
    const sim = broker("topic");
    sim.setNodeStatus("c", "paused");
    sim.inject("b", 9);
    run(sim, 500);
    expect(sim.snapshot().nodes.b.backlog).toBe(9);
    expect(sim.snapshot().nodes.c.processed).toBe(0);
    sim.setNodeStatus("c", "up");
    run(sim);
    expect(sim.snapshot().nodes.b.backlog).toBe(0);
    expect(sim.snapshot().nodes.end.processed).toBe(9);
  });

  it("an already-down consumer is never offered broker messages", () => {
    const sim = broker();
    sim.setNodeStatus("c", "down");
    sim.inject("b", 4);
    run(sim);
    expect(sim.snapshot().nodes.b.backlog).toBe(4);
    expect(sim.snapshot().nodes.c.failed).toBe(0);
    expect(sim.snapshot().edges["b-c"].delivered).toBe(0);
  });

  it("paused processors accept pushed work and freeze current work", () => {
    const sim = engine(
      [node("s", "source"), node("p", "processor", { latencyMs: 100, concurrency: 1 }), node("end", "sink")],
      [edge("s", "p"), edge("p", "end")],
    );
    sim.inject("s", 3);
    sim.step(30);
    expect(sim.snapshot().nodes.p.inFlight).toBe(1);
    sim.setNodeStatus("p", "paused");
    run(sim, 1000);
    expect(sim.snapshot().nodes.p.backlog).toBe(2);
    expect(sim.snapshot().nodes.p.processed).toBe(0);
    sim.setNodeStatus("p", "up");
    run(sim);
    expect(sim.snapshot().nodes.end.processed).toBe(3);
  });

  it("paused brokers hold publications and resume", () => {
    const sim = broker();
    sim.setNodeStatus("b", "paused");
    sim.inject("b", 6);
    run(sim, 200);
    expect(sim.snapshot().nodes.b.backlog).toBe(6);
    sim.setNodeStatus("b", "up");
    run(sim);
    expect(sim.snapshot().nodes.end.processed).toBe(6);
  });

  it("paused topics still append publications to every group's log", () => {
    const sim = engine(
      [node("b", "topic"), node("a", "sink"), node("c", "sink")],
      [edge("b", "a", { group: "a" }), edge("b", "c", { group: "c" })],
    );
    sim.inject("b", 3);
    sim.setNodeStatus("b", "paused");
    sim.inject("b", 4);
    run(sim, 100);
    expect(sim.snapshot().nodes.b.lag).toEqual({ a: 7, c: 7 });
    expect(sim.snapshot().nodes.b.backlog).toBe(7);
    sim.setNodeStatus("b", "up");
    run(sim);
    expect(sim.snapshot().nodes.a.processed).toBe(7);
    expect(sim.snapshot().nodes.c.processed).toBe(7);
  });

  it("readiness skips paused consumers within a shared group", () => {
    const sim = engine(
      [node("b", "topic"), node("a", "processor", { latencyMs: 10 }), node("c", "processor", { latencyMs: 10 })],
      [edge("b", "a", { group: "shared" }), edge("b", "c", { group: "shared" })],
    );
    sim.setNodeStatus("a", "paused");
    sim.inject("b", 8);
    run(sim);
    expect(sim.snapshot().nodes.a.processed).toBe(0);
    expect(sim.snapshot().nodes.c.processed).toBe(8);
  });

  it("broker-to-broker delivery acknowledges on publication and drains", () => {
    const sim = engine(
      [node("t", "topic", { partitions: 1 }), node("q", "queue"), node("end", "sink")],
      [edge("t", "q"), edge("q", "end")],
    );
    sim.inject("t", 20);
    run(sim);
    expect(sim.snapshot().nodes.q.processed).toBe(20);
    expect(sim.snapshot().nodes.end.processed).toBe(20);
    expect(sim.snapshot().inSystem).toBe(0);
  });

  it("brokers with no consumers retain messages, including DLQ queues", () => {
    const sim = engine([node("q", "queue")], []);
    sim.inject("q", 5);
    run(sim);
    expect(sim.snapshot().nodes.q.backlog).toBe(5);
    expect(sim.snapshot().nodes.q.lag).toEqual({ queue: 5 });
    expect(sim.snapshot().nodes.q.processed).toBe(5);
    expect(sim.snapshot().inSystem).toBe(5);
  });

  it("processor concurrency creates backlog for pushes", () => {
    const sim = engine([node("p", "processor", { latencyMs: 1000, concurrency: 2 })], []);
    sim.inject("p", 10);
    sim.step(10);
    expect(sim.snapshot().nodes.p.inFlight).toBe(2);
    expect(sim.snapshot().nodes.p.backlog).toBe(8);
  });
});

describe("failures and replies", () => {
  it.each(["queue", "topic", "stream"] as const)(
    "%s retries in the same group and deadletters at the delivery limit",
    (role) => {
      const sim = broker(role, { maxDeliveryCount: 3 }, { group: "workers" });
      sim.setNodeProps("c", { failureRate: 1 });
      sim.inject("b", 1);
      let sawRetry = false,
        sawDlq = false;
      for (let i = 0; i < 150; i++) {
        sim.step(10);
        sawRetry ||= sim.snapshot().particles.some((p) => p.kind === "retry");
        sawDlq ||= sim.snapshot().particles.some((p) => p.kind === "dlq");
      }
      const snap = sim.snapshot();
      expect(sawRetry).toBe(true);
      expect(sawDlq).toBe(true);
      expect(snap.nodes.c.failed).toBe(3);
      expect(snap.nodes.b.deadLettered).toBe(1);
      expect(snap.nodes.dlq.processed).toBe(1);
      expect(snap.edges["b-c"].delivered).toBe(3);
      expect(snap.nodes.b.backlog).toBe(0);
      expect(snap.inSystem).toBe(0);
    },
  );

  it("a consumer going down during each delivery retries then reaches DLQ", () => {
    const sim = broker("queue", { maxDeliveryCount: 3 }, { travelMs: 100 });
    sim.inject("b", 1);
    for (let attempt = 0; attempt < 3; attempt++) {
      sim.setNodeStatus("c", "up");
      sim.step(10); // broker reserves a delivery
      sim.setNodeStatus("c", "down");
      sim.step(100); // arrival fails
      expect(sim.snapshot().particles.some((p) => p.kind === "retry")).toBe(true);
      sim.step(100); // retry returns, with consumer still down
    }
    run(sim, 100);
    expect(sim.snapshot().nodes.c.failed).toBe(3);
    expect(sim.snapshot().nodes.b.deadLettered).toBe(1);
    expect(sim.snapshot().nodes.dlq.processed).toBe(1);
  });

  it("delivery limit without DLQ drops the message", () => {
    const sim = engine(
      [node("q", "queue", { maxDeliveryCount: 2 }), node("p", "processor", { failureRate: 1, latencyMs: 10 })],
      [edge("q", "p")],
    );
    sim.inject("q", 4);
    run(sim);
    expect(sim.snapshot().nodes.p.failed).toBe(8);
    expect(sim.snapshot().nodes.q.dropped).toBe(4);
    expect(sim.snapshot().inSystem).toBe(0);
  });

  it("DLQ can be explicit or inferred from sublabel", () => {
    for (const explicit of [true, false]) {
      const target = { ...node("dead", "store"), sublabel: explicit ? "errors" : "dead-letter mailbox" };
      const sim = engine(
        [node("q", "queue", { maxDeliveryCount: 1 }), node("p", "processor", { failureRate: 1, latencyMs: 0 }), target],
        [edge("q", "p"), edge("q", "dead", explicit ? { dlq: true } : {})],
      );
      sim.inject("q", 3);
      run(sim);
      expect(sim.snapshot().nodes.dead.processed).toBe(3);
      expect(sim.snapshot().nodes.q.deadLettered).toBe(3);
    }
  });

  it("down processors drop pushed messages", () => {
    const sim = engine([node("s", "source"), node("p", "processor")], [edge("s", "p")]);
    sim.setNodeStatus("p", "down");
    sim.inject("s", 5);
    run(sim);
    expect(sim.snapshot().nodes.p.dropped).toBe(5);
    expect(sim.snapshot().nodes.p.failed).toBe(5);
    expect(sim.snapshot().inSystem).toBe(0);
  });

  it.each([0, 1])("failureRate %s controls successful processing", (failureRate) => {
    const sim = engine(
      [node("p", "processor", { failureRate, latencyMs: 10 }), node("end", "sink")],
      [edge("p", "end")],
    );
    sim.inject("p", 10);
    run(sim);
    expect(sim.snapshot().nodes.p.failed).toBe(failureRate * 10);
    expect(sim.snapshot().nodes.end.processed).toBe((1 - failureRate) * 10);
  });

  it("one topic group's failures do not affect other groups", () => {
    const sim = engine(
      [
        node("b", "topic", { maxDeliveryCount: 2 }),
        node("bad", "processor", { failureRate: 1, latencyMs: 0 }),
        node("good", "sink"),
        node("dlq", "sink"),
      ],
      [edge("b", "bad", { group: "bad" }), edge("b", "good", { group: "good" }), edge("b", "dlq", { dlq: true })],
    );
    sim.inject("b", 5);
    run(sim);
    expect(sim.snapshot().nodes.good.processed).toBe(5);
    expect(sim.snapshot().nodes.bad.failed).toBe(10);
    expect(sim.snapshot().nodes.dlq.processed).toBe(5);
  });

  it("retry can recover after a live failureRate change", () => {
    const sim = broker();
    sim.setNodeProps("c", { failureRate: 1 });
    sim.inject("b", 1);
    run(sim, 60);
    expect(sim.snapshot().particles.some((p) => p.kind === "retry")).toBe(true);
    sim.setNodeProps("c", { failureRate: 0 });
    run(sim);
    expect(sim.snapshot().nodes.c.failed).toBe(1);
    expect(sim.snapshot().nodes.end.processed).toBe(1);
    expect(sim.snapshot().nodes.b.deadLettered).toBe(0);
  });

  it.each(["store", "sink", "processor"] as const)(
    "sync edge into %s replies on completion without caller waiting",
    (role) => {
      const request = { ...edge("s", "t", { travelMs: 100 }), kind: "sync" as const };
      const sim = engine(
        [node("s", "source"), node("t", role, { latencyMs: 40 }), node("end", "sink")],
        [request, edge("s", "end")],
      );
      sim.inject("s", 1);
      sim.step(20);
      expect(sim.snapshot().nodes.end.processed).toBe(1);
      sim.step(130);
      const response = sim.snapshot().particles.find((p) => p.kind === "reply");
      expect(response?.edgeId).toBe("s-t");
      expect(response?.messageId).toBe(1);
      expect(sim.snapshot().edges["s-t"].delivered).toBe(1);
      run(sim);
      expect(sim.snapshot().nodes.s.processed).toBe(1);
      expect(sim.snapshot().inSystem).toBe(0);
    },
  );
});

describe("API, clocks, and snapshots", () => {
  it("continuous traffic respects diagram ratePerSec and live overrides", () => {
    const sim = engine([node("s", "source", { ratePerSec: 7.5 }), node("end", "sink")], [edge("s", "end")]);
    sim.setTraffic(true);
    run(sim, 10000);
    expect(sim.snapshot().nodes.s.processed).toBe(75);
    expect(sim.snapshot().nodes.s.throughput).toBeGreaterThan(6);
    sim.setNodeProps("s", { ratePerSec: 3 });
    run(sim, 10000);
    expect(sim.snapshot().nodes.s.processed).toBe(105);
    sim.setTraffic(false);
    run(sim, 1000);
    expect(sim.snapshot().nodes.s.processed).toBe(105);
  });

  it("default source traffic is 2 per second and stops while paused/down", () => {
    const sim = engine([node("s", "source"), node("end", "sink")], [edge("s", "end")]);
    sim.setTraffic(true);
    run(sim, 2000);
    expect(sim.snapshot().nodes.s.processed).toBe(4);
    sim.setNodeStatus("s", "paused");
    run(sim, 2000);
    sim.setNodeStatus("s", "down");
    run(sim, 2000);
    expect(sim.snapshot().nodes.s.processed).toBe(4);
    sim.setNodeStatus("s", "up");
    run(sim, 1000);
    expect(sim.snapshot().nodes.s.processed).toBe(6);
  });

  it("role defaults provide processor latency/capacity and async/sync travel times", () => {
    const sim = engine(
      [node("s", "source"), node("p", "processor"), node("store", "store")],
      [
        { id: "async", from: "s", to: "p" },
        { id: "sync", from: "p", to: "store", kind: "sync" },
      ],
    );
    sim.inject("s", 5);
    sim.step(290);
    expect(sim.snapshot().nodes.p.inFlight).toBe(0);
    expect(sim.snapshot().particles[0].progress).toBeCloseTo(290 / 300);
    sim.step(10);
    expect(sim.snapshot().nodes.p.inFlight).toBe(4);
    expect(sim.snapshot().nodes.p.backlog).toBe(1);
    sim.step(240);
    expect(sim.snapshot().nodes.p.processed).toBe(0);
    sim.step(10);
    expect(sim.snapshot().nodes.p.processed).toBe(4);
    sim.step(200);
    expect(sim.snapshot().nodes.store.processed).toBe(0);
    sim.step(40);
    expect(sim.snapshot().nodes.store.processed).toBe(4);
    expect(sim.snapshot().particles.filter((p) => p.kind === "reply")).toHaveLength(4);
  });

  it("loads initial status from diagram props", () => {
    const sim = engine([node("p", "processor", { status: "paused", latencyMs: 10 })], []);
    sim.inject("p", 1);
    run(sim, 100);
    expect(sim.snapshot().nodes.p.status).toBe("paused");
    expect(sim.snapshot().nodes.p.backlog).toBe(1);
    sim.setNodeStatus("p", "up");
    run(sim);
    expect(sim.snapshot().nodes.p.processed).toBe(1);
  });

  it("live concurrency changes release backlog and survive reset", () => {
    const sim = engine([node("p", "processor", { concurrency: 0, latencyMs: 10 })], []);
    sim.inject("p", 5);
    run(sim, 100);
    expect(sim.snapshot().nodes.p.backlog).toBe(5);
    sim.setNodeProps("p", { concurrency: 5 });
    sim.step(10);
    expect(sim.snapshot().nodes.p.inFlight).toBe(5);
    run(sim);
    sim.reset();
    sim.inject("p", 5);
    sim.step(10);
    expect(sim.snapshot().nodes.p.inFlight).toBe(5);
  });

  it.each([
    [2, 2000],
    [0.25, 250],
    [100, 8000],
    [-1, 250],
  ])("speed %s yields %s simulation ms", (speed, expected) => {
    const sim = engine([node("s", "source", { ratePerSec: 4 })], []);
    sim.setTraffic(true);
    sim.setSpeed(speed);
    sim.step(1000);
    expect(sim.snapshot().time).toBe(expected);
    expect(sim.snapshot().nodes.s.processed).toBe(expected / 250);
  });

  it("uses an accumulator and gives the same result for different frame sizes", () => {
    const make = () =>
      engine(
        [node("s", "source", { ratePerSec: 9 }), node("p", "processor", { failureRate: 0.4 }), node("end", "store")],
        [edge("s", "p"), edge("p", "end")],
      );
    const a = make(),
      b = make();
    a.setTraffic(true);
    b.setTraffic(true);
    a.step(3);
    a.step(6);
    expect(a.snapshot().time).toBe(0);
    a.step(1);
    expect(a.snapshot().time).toBe(10);
    a.step(9990);
    for (let i = 0; i < 600; i++) b.step(10000 / 600);
    expect(a.snapshot()).toEqual(b.snapshot());
  });

  it("reset clears counters/messages/schedules while retaining status and live props", () => {
    const sim = broker();
    sim.inject("b", 5, { spreadMs: 10000 });
    run(sim, 100);
    sim.setNodeStatus("c", "paused");
    sim.setNodeProps("c", { failureRate: 1 });
    sim.reset();
    const snap = sim.snapshot();
    expect(snap.time).toBe(0);
    expect(snap.events).toEqual([]);
    expect(snap.particles).toEqual([]);
    expect(snap.inSystem).toBe(0);
    for (const n of Object.values(snap.nodes))
      expect(n.processed + n.failed + n.dropped + n.deadLettered + n.throughput + n.backlog + n.inFlight).toBe(0);
    expect(snap.nodes.c.status).toBe("paused");
    run(sim, 11000);
    expect(sim.snapshot().inSystem).toBe(0);
    sim.setNodeStatus("c", "up");
    sim.inject("b", 1);
    run(sim);
    expect(sim.snapshot().nodes.c.failed).toBe(3);
  });

  it("load replaces all old state and overrides", () => {
    const sim = broker();
    sim.inject("b", 1);
    sim.setNodeStatus("c", "down");
    sim.load(diagram([node("new", "sink")], []));
    expect(Object.keys(sim.snapshot().nodes)).toEqual(["new"]);
    expect(sim.snapshot().events).toEqual([]);
    expect(sim.snapshot().inSystem).toBe(0);
  });

  it("spread injection includes the first now and last at spreadMs", () => {
    const sim = engine([node("s", "source", { messageType: "Configured" }), node("end", "sink")], [edge("s", "end")]);
    sim.inject("s", 5, { spreadMs: 1000 });
    expect(sim.snapshot().nodes.s.processed).toBe(1);
    sim.step(240);
    expect(sim.snapshot().nodes.s.processed).toBe(1);
    sim.step(10);
    expect(sim.snapshot().nodes.s.processed).toBe(2);
    sim.step(740);
    expect(sim.snapshot().nodes.s.processed).toBe(4);
    sim.step(10);
    expect(sim.snapshot().nodes.s.processed).toBe(5);
    expect(sim.snapshot().particles[0].type).toBe("Configured");
    run(sim);
    expect(sim.snapshot().nodes.end.processed).toBe(5);
  });

  it("orders overlapping spread batches by time and creation order", () => {
    const sim = engine([node("s", "source"), node("end", "sink")], [edge("s", "end")]);
    sim.inject("s", 3, { spreadMs: 100, type: "A" });
    sim.inject("s", 3, { spreadMs: 40, type: "B" });
    sim.inject("s", 3, { spreadMs: 100, type: "C" });
    sim.step(100);
    expect(
      sim
        .snapshot()
        .events.filter((e) => e.kind === "inject")
        .map((e) => e.text.split(" ")[2]),
    ).toEqual(["A", "B", "C", "B", "B", "A", "C", "A", "C"]);
  });

  it.each([0, 2])("maxParticles=%s limits drawing without stopping deliveries", (cap) => {
    const sim = engine([node("s", "source"), node("end", "sink")], [edge("s", "end", { travelMs: 100 })], {
      maxParticles: cap,
    });
    sim.inject("s", 100);
    expect(sim.snapshot().particles).toHaveLength(cap);
    expect(sim.snapshot().inSystem).toBe(100);
    expect(sim.snapshot().edges["s-end"].active).toBe(100);
    run(sim);
    expect(sim.snapshot().nodes.end.processed).toBe(100);
    expect(sim.snapshot().edges["s-end"].delivered).toBe(100);
    expect(sim.snapshot().inSystem).toBe(0);
  });

  it("identical seeded runs give identical snapshots, including mixed failures", () => {
    const make = () => {
      const sim = broker("topic");
      sim.setNodeProps("c", { failureRate: 0.45 });
      sim.inject("b", 40, { spreadMs: 1000, type: "Order" });
      return sim;
    };
    const a = make(),
      b = make();
    for (let i = 0; i < 100; i++) {
      a.step(17);
      b.step(17);
      expect(a.snapshot()).toEqual(b.snapshot());
    }
    expect(a.snapshot().nodes.c.failed).toBeGreaterThan(0);
    expect(a.snapshot().nodes.c.processed).toBeGreaterThan(0);
  });

  it("reset restores the seeded random sequence", () => {
    const sim = broker();
    sim.setNodeProps("c", { failureRate: 0.5 });
    sim.inject("b", 20);
    run(sim);
    const first = sim.snapshot();
    sim.reset();
    sim.inject("b", 20);
    run(sim);
    // Status/props changes are also cleared from the recent event history on reset.
    expect(sim.snapshot().nodes).toEqual(first.nodes);
    expect(sim.snapshot().edges).toEqual(first.edges);
  });

  it("caps events, preserves chronological order, and snapshots are detached", () => {
    const sim = engine([node("s", "source"), node("end", "sink")], [edge("s", "end")]);
    sim.inject("s", 150);
    run(sim, 100);
    const snap = sim.snapshot();
    expect(snap.events).toHaveLength(200);
    expect(snap.events.every((e, i) => i === 0 || e.time >= snap.events[i - 1].time)).toBe(true);
    snap.nodes.end.processed = -1;
    snap.events[0].text = "mutated";
    snap.edges["s-end"].delivered = -1;
    expect(sim.snapshot().nodes.end.processed).toBe(150);
    expect(sim.snapshot().events[0].text).not.toBe("mutated");
    expect(sim.snapshot().edges["s-end"].delivered).toBe(150);
    const throughput = sim.snapshot().nodes.end.throughput;
    run(sim, 2000);
    expect(sim.snapshot().nodes.end.throughput).toBeLessThan(throughput);
  });

  it("ignores unknown ids, dangling edges, invalid time, and invalid tuning numbers", () => {
    const sim = engine(
      [node("p", "processor", { latencyMs: NaN, concurrency: Infinity })],
      [edge("p", "missing"), edge("missing", "p")],
    );
    expect(() => {
      sim.inject("missing", 1);
      sim.setNodeStatus("missing", "down");
      sim.setNodeProps("missing", { latencyMs: 1 });
    }).not.toThrow();
    sim.step(NaN);
    sim.step(Infinity);
    sim.step(-1);
    sim.inject("p", NaN);
    sim.inject("p", -1);
    expect(sim.snapshot().time).toBe(0);
    expect(sim.snapshot().edges).toEqual({});
    sim.inject("p", 1);
    run(sim);
    expect(sim.snapshot().nodes.p.processed).toBe(1);
  });

  it("message type hashes stably into the vivid palette", () => {
    expect(messageColor("OrderPlaced")).toBe(messageColor("OrderPlaced"));
    expect(MESSAGE_PALETTE).toContain(messageColor("OrderPlaced"));
    expect(new Set(["OrderPlaced", "Payment", "Telemetry", "Invoice", "Alert"].map(messageColor)).size).toBeGreaterThan(
      2,
    );
  });

  it("sustains a 40-node/60-edge graph at 60 snapshots/s near the particle cap", () => {
    const nodes: DiagramNode[] = [],
      edges: DiagramEdge[] = [];
    for (let i = 0; i < 10; i++) {
      nodes.push(node(`s${i}`, "source", { ratePerSec: 50 }));
      nodes.push(node(`p${i}`, "processor", { latencyMs: 30, concurrency: 8 }));
      edges.push(edge(`s${i}`, `p${i}`, { travelMs: 300 }));
      edges.push(edge(`s${i}`, `p${(i + 1) % 10}`, { travelMs: 300 }));
      for (let j = 0; j < 4; j++) edges.push(edge(`p${i}`, `t${(i * 2 + j) % 20}`, { travelMs: 300 }));
    }
    for (let i = 0; i < 20; i++) nodes.push(node(`t${i}`, "sink"));
    const sim = engine(nodes, edges);
    sim.setTraffic(true);
    let peak = 0;
    for (let frame = 0; frame < 600; frame++) {
      sim.step(1000 / 60);
      const snap = sim.snapshot();
      peak = Math.max(peak, snap.particles.length);
      expect(snap.particles.length).toBeLessThanOrEqual(1500);
    }
    expect(peak).toBe(1500);
    sim.setTraffic(false);
    run(sim, 2000);
    const snap = sim.snapshot();
    expect(Object.keys(snap.nodes)).toHaveLength(40);
    expect(Object.keys(snap.edges)).toHaveLength(60);
    expect(
      Object.values(snap.nodes)
        .filter((n) => n.role === "sink")
        .reduce((sum, n) => sum + n.processed, 0),
    ).toBe(40000);
    expect(snap.inSystem).toBe(0);
  });
});

describe("terminal consumers", () => {
  it("a processor with no outgoing edges counts messages as processed, not dropped", () => {
    const sim = engine([node("q", "queue"), node("worker", "processor", { latencyMs: 10 })], [edge("q", "worker")]);
    sim.inject("q", 5);
    run(sim, 3000);
    const w = sim.snapshot().nodes.worker;
    expect(w.processed).toBe(5);
    expect(w.dropped).toBe(0);
    expect(sim.snapshot().inSystem).toBe(0);
  });
});

describe("change feeds", () => {
  it("a store forwards copies along its async edges and stays terminal for sync ones", () => {
    const sim = engine(
      [
        node("producer", "source"),
        node("db", "store", { latencyMs: 10 }),
        node("cdc", "processor", { latencyMs: 10 }),
        node("sink", "sink"),
        node("app", "store"),
      ],
      [edge("producer", "db"), edge("db", "cdc"), edge("cdc", "sink"), { ...edge("db", "app"), kind: "sync" }],
    );
    sim.inject("producer", 4);
    run(sim, 3000);
    const snap = sim.snapshot();
    expect(snap.nodes.sink.processed).toBe(4);
    expect(snap.nodes.app.processed).toBe(0);
    expect(snap.inSystem).toBe(0);
  });
});

describe("real example smoke tests", () => {
  const examples = import.meta.glob<DiagramFile>("../examples/*.json", { eager: true, import: "default" });
  it.each(Object.entries(examples))("runs %s for 30 seconds with the real registry", (_path, input) => {
    const sim = createEngine({ seed: 42 });
    sim.load(input);
    // Entry points: source stencils plus any node nothing flows into (e.g. a CDC source database).
    const entries = input.nodes.filter(
      (n) =>
        getStencil(n.stencil).simRole === "source" ||
        (!input.edges.some((e) => e.to === n.id) && input.edges.some((e) => e.from === n.id)),
    );
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) sim.inject(entry.id, 5);
    run(sim, 30000);
    const snap = sim.snapshot();
    expect(
      Object.values(snap.nodes)
        .filter(
          (n) =>
            n.role === "store" ||
            n.role === "sink" ||
            (n.role === "processor" && !input.edges.some((e) => e.from === n.id)),
        )
        .reduce((sum, n) => sum + n.processed, 0),
    ).toBeGreaterThan(0);
    expect(snap.inSystem).toBeGreaterThanOrEqual(0);
    expect(snap.particles.every((p) => p.progress >= 0 && p.progress <= 1)).toBe(true);
  });
});

describe("continuous source safety budget", () => {
  it("an explicit scale of one cannot emit an unsafe continuous rate, but safe sampling keeps that real rate", () => {
    const e = engine([node("web", "source", { ratePerSec: 10_000_000 }), node("q", "queue")], [edge("web", "q")]);
    e.setTraffic(true);
    e.step(10);
    expect(e.metrics().inSystem).toBe(0);
    e.setScale(10_000_000 / SOURCE_RATE_CAP);
    e.setTraffic(true);
    e.step(10);
    expect(e.frame().nodes.web.processed).toBe(SOURCE_RATE_CAP / 100);
    expect(e.frame().scale).toBe(1_000);
    e.setScale(1);
    e.step(10);
    expect(e.frame().nodes.web.processed).toBe(SOURCE_RATE_CAP / 100);
  });

  it("rate checks aggregate sources, include live patches, and fail closed before any emission", () => {
    const e = engine(
      [node("a", "source", { ratePerSec: SOURCE_RATE_CAP }), node("b", "source", { ratePerSec: SOURCE_RATE_CAP })],
      [],
    );
    e.setTraffic(true);
    e.step(10);
    expect(e.frame().nodes.a.processed + e.frame().nodes.b.processed).toBe(0);
    e.setNodePropsBatch({ a: { ratePerSec: 0 }, b: { ratePerSec: 1 } });
    e.setTraffic(true);
    e.step(1_000);
    expect(e.frame().nodes.b.processed).toBe(1);
    e.setNodeProps("b", { ratePerSec: 10_000_000 });
    e.step(10);
    expect(e.frame().nodes.b.processed).toBe(1);
  });

  it("continuous volume is bounded across toggles and checkpoints and reset by restart", () => {
    const e = engine([node("web", "source", { ratePerSec: SOURCE_RATE_CAP }), node("q", "queue")], [edge("web", "q")], {
      maxParticles: 0,
    });
    e.setTraffic(true);
    e.step(10);
    const checkpoint = e.checkpoint();
    e.step(30_000);
    expect(e.frame().nodes.web.processed).toBe(SOURCE_VOLUME_CAP);
    expect(e.metrics().inSystem).toBe(SOURCE_VOLUME_CAP);
    e.setTraffic(false);
    e.setTraffic(true);
    e.step(10);
    expect(e.frame().nodes.web.processed).toBe(SOURCE_VOLUME_CAP);
    e.restore(checkpoint);
    e.step(30_000);
    expect(e.frame().nodes.web.processed).toBe(SOURCE_VOLUME_CAP);
    e.reset();
    e.setTraffic(true);
    e.step(10);
    expect(e.frame().nodes.web.processed).toBe(SOURCE_RATE_CAP / 100);
  });
});
