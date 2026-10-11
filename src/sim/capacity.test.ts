import { describe, expect, it } from "vitest";
import type { DiagramEdge, DiagramFile, DiagramNode, Simulation } from "../model/types";
import { analyzeCapacity } from "./capacity";
import { createSimulationRun } from "./simulation";

const node = (id: string, stencil = "generic.service", props: Record<string, unknown> = {}): DiagramNode => ({
  id,
  stencil,
  label: id,
  x: 0,
  y: 0,
  props: { jitter: 0, ...props },
});
const edge = (from: string, to: string, props: Record<string, unknown> = {}, id = `${from}-${to}`): DiagramEdge => ({
  id,
  from,
  to,
  props: { travelMs: 10, ...props },
});
const diagram = (nodes: DiagramNode[], edges: DiagramEdge[] = []): DiagramFile => ({
  format: "diagrams/v1",
  title: "Capacity",
  nodes,
  edges,
});
const traffic = (rates: Record<string, number>, patch: Partial<Simulation> = {}): Simulation => ({
  id: "capacity",
  title: "Capacity",
  traffic: Object.entries(rates).map(([id, rate]) => ({
    id,
    node: id,
    shape: { kind: "constant", ratePerSec: rate, durationMs: 60000 },
  })),
  ...patch,
});

describe("capacity routing regressions", () => {
  it.each(["generic.queue", "kafka.topic", "azure.event-hubs"])(
    "%s excludes incompatible consumers and preserves blocked demand",
    (stencil) => {
      const d = diagram(
        [
          node("s", "client.user"),
          node("b", stencil, { partitions: 10 }),
          node("orders", undefined, { status: "paused", concurrency: 1, latencyMs: 100 }),
          node("invoices", undefined, { concurrency: 1, latencyMs: 100 }),
        ],
        [
          edge("s", "b", { share: 0.5, emits: "Order" }),
          edge("b", "orders", { group: "g", filter: ["Order"] }),
          edge("b", "invoices", { group: "g", filter: ["Invoice"] }),
        ],
      );
      const result = analyzeCapacity(d, traffic({ s: 10 }));
      expect(result.nodes.b).toMatchObject({ offered: 5, capacity: 0, utilization: Infinity });
      expect(result.nodes.orders).toMatchObject({ offered: 5, utilization: Infinity });
      expect(result.nodes.invoices.offered).toBe(0);
    },
  );

  it("accounts for per-type compatibility and shared service budgets within a group", () => {
    const d = diagram(
      [
        node("b", "generic.queue"),
        node("a", undefined, { concurrency: 1, latencyMs: 100 }),
        node("c", undefined, { concurrency: 1, latencyMs: 100 }),
      ],
      [edge("b", "a", { filter: ["Order", "Invoice"] }), edge("b", "c", { filter: ["Invoice"] })],
    );
    const profiles: Simulation["traffic"] = [
      { id: "o", node: "b", messageType: "Order", shape: { kind: "constant", ratePerSec: 8, durationMs: 1000 } },
      { id: "i", node: "b", messageType: "Invoice", shape: { kind: "constant", ratePerSec: 8, durationMs: 1000 } },
    ];
    expect(analyzeCapacity(d, traffic({}, { traffic: profiles })).nodes.b.capacity).toBe(20);
    profiles[0].shape = { kind: "constant", ratePerSec: 12, durationMs: 1000 };
    profiles[1].shape = { kind: "constant", ratePerSec: 4, durationMs: 1000 };
    expect(analyzeCapacity(d, traffic({}, { traffic: profiles })).nodes.b.capacity).toBeCloseTo(40 / 3);
  });

  it("normalizes DLQ classification identically to playback, including ordinary source/store edges", () => {
    const d = diagram(
      [node("s", "client.user"), node("db", "postgres", { latencyMs: 0 }), node("p")],
      [edge("s", "db", { dlq: true }), edge("db", "p", { dlq: true })],
    );
    const input = traffic({ s: 5 });
    const analysis = analyzeCapacity(d, input);
    expect(analysis.nodes.db.offered).toBe(5);
    expect(analysis.nodes.p.offered).toBe(5);
    const run = createSimulationRun(d, {
      ...input,
      traffic: [{ id: "burst", node: "s", shape: { kind: "burst", count: 10 } }],
      durationMs: 2000,
    });
    run.step(2000);
    expect(run.engine.frame().nodes.db.processed).toBe(10);
    expect(run.engine.frame().nodes.p.processed).toBeGreaterThan(0);
  });

  it("finds a shared type-subset limit and handles unlimited compatible consumers", () => {
    const d = diagram(
      [
        node("b", "generic.queue"),
        node("a", undefined, { concurrency: 1, latencyMs: 100 }),
        node("c", undefined, { concurrency: 1, latencyMs: 100 }),
      ],
      [edge("b", "a", { filter: ["Order", "Invoice"] }), edge("b", "c", { filter: ["Email"] })],
    );
    const profiles: Simulation["traffic"] = ["Order", "Invoice", "Email"].map((type) => ({
      id: type,
      node: "b",
      messageType: type,
      shape: { kind: "constant", ratePerSec: 5, durationMs: 1000 },
    }));
    expect(analyzeCapacity(d, traffic({}, { traffic: profiles })).nodes.b.capacity).toBe(15);
    d.nodes[2] = node("c", "generic.email");
    expect(analyzeCapacity(d, traffic({}, { traffic: profiles })).nodes.b.capacity).toBe(15);
    d.edges[1] = edge("b", "c");
    expect(analyzeCapacity(d, traffic({}, { traffic: profiles })).nodes.b.capacity).toBe(Infinity);
  });
});

describe("capacity analysis by hand", () => {
  it("computes real processor capacity and replica suggestions without mutation or a run", () => {
    const d = diagram(
      [node("s", "client.user"), node("p", undefined, { replicas: 2, concurrency: 2, latencyMs: 1000 })],
      [edge("s", "p")],
    );
    const input = traffic({ s: 8 });
    const before = structuredClone({ d, input });
    const result = analyzeCapacity(d, input);
    expect(result.nodes.p).toMatchObject({ capacity: 4, offered: 8, utilization: 2, replicas: 2, activeReplicas: 2 });
    expect(result.bottleneck?.id).toBe("p");
    expect(result.suggestion).toContain("from 2 to 4");
    expect({ d, input }).toEqual(before);
    expect(result.converged).toBe(true);
  });
  it("copies fan-out and accounts for edge share, node emits, edge emits and filters", () => {
    const d = diagram(
      [
        node("s", "client.user"),
        node("p", undefined, { emits: { Order: "Paid", "*": "Other" } }),
        node("a", "generic.email"),
        node("b", "generic.email"),
        node("c", "generic.email"),
      ],
      [
        edge("s", "p", { emits: "Order" }),
        edge("s", "c"),
        edge("p", "a", { filter: ["Paid*"], share: 0.35, emits: "Email" }),
        edge("a", "b", { filter: ["Email"] }),
        edge("p", "b", { filter: ["Order"] }),
      ],
    );
    const result = analyzeCapacity(d, traffic({ s: 100 }));
    expect(result.nodes.p.offered).toBe(100);
    expect(result.nodes.c.offered).toBe(100);
    expect(result.nodes.a.offered).toBe(35);
    expect(result.nodes.b.offered).toBe(0);
  });
  it("round-robins gateways, with a single-lane latency capacity for gateway/store planning", () => {
    const d = diagram(
      [
        node("g", "nginx", { latencyMs: 100 }),
        node("a", "postgres", { latencyMs: 50 }),
        node("b", "postgres", { latencyMs: 100 }),
      ],
      [edge("g", "a"), edge("g", "b")],
    );
    const result = analyzeCapacity(d, traffic({ g: 12 }));
    expect(result.nodes.g).toMatchObject({ offered: 12, capacity: 10, utilization: 1.2 });
    expect(result.nodes.a).toMatchObject({ offered: 6, capacity: 20, utilization: 0.3 });
    expect(result.nodes.b).toMatchObject({ offered: 6, capacity: 10, utilization: 0.6 });
  });
  it("queues split competing traffic in proportion to consumer capacity, rather than copy", () => {
    const d = diagram(
      [
        node("q", "generic.queue"),
        node("a", undefined, { concurrency: 1, latencyMs: 500 }),
        node("b", undefined, { replicas: 3, concurrency: 1, latencyMs: 500 }),
      ],
      [edge("q", "a"), edge("q", "b")],
    );
    const result = analyzeCapacity(d, traffic({ q: 8 }));
    expect(result.nodes.q).toMatchObject({ capacity: 8, offered: 8, utilization: 1 });
    expect(result.nodes.a.offered).toBe(2);
    expect(result.nodes.b.offered).toBe(6);
    expect(result.nodes.b.activeReplicas).toBe(3);
  });
  it.each(["kafka.topic", "azure.event-hubs"])(
    "%s copies per group and caps active replicas by partitions",
    (stencil) => {
      const d = diagram(
        [
          node("t", stencil, { partitions: 3 }),
          node("Payments", undefined, { replicas: 6, concurrency: 2, latencyMs: 100 }),
          node("audit", undefined, { replicas: 3, concurrency: 4, latencyMs: 100 }),
        ],
        [edge("t", "Payments", { group: "pay" }), edge("t", "audit", { group: "audit" })],
      );
      const result = analyzeCapacity(d, traffic({ t: 90 }));
      expect(result.nodes.Payments).toMatchObject({
        capacity: 60,
        offered: 90,
        utilization: 1.5,
        activeReplicas: 3,
        idleReplicas: 3,
      });
      expect(result.nodes.audit).toMatchObject({ capacity: 120, offered: 90, utilization: 0.75 });
      expect(result.nodes.t).toMatchObject({ capacity: 60, utilization: 1.5 });
      expect(result.bottleneck?.id).toBe("Payments");
      expect(result.suggestion).toContain("3 of 6 replicas idle");
      expect(result.suggestion).toContain("(3 -> 6)");
    },
  );
  it("divides partition assignments among nodes sharing a group and coalesces duplicate members", () => {
    const d = diagram(
      [
        node("t", "kafka.topic", { partitions: 3 }),
        node("a", undefined, { replicas: 4, concurrency: 1, latencyMs: 1000 }),
        node("b", undefined, { replicas: 4, concurrency: 1, latencyMs: 1000 }),
      ],
      [edge("t", "a", { group: "g" }), edge("t", "a", { group: "g" }, "duplicate"), edge("t", "b", { group: "g" })],
    );
    const result = analyzeCapacity(d, traffic({ t: 3 }));
    expect(result.nodes.a.activeReplicas + result.nodes.b.activeReplicas).toBe(3);
    expect(result.nodes.t.capacity).toBe(3);
    // Duplicate delivery routes still participate in ready-consumer round-robin.
    expect(result.nodes.a.offered).toBe(2);
    expect(result.nodes.b.offered).toBe(1);
  });
  it("normalizes broker capacity for filtered groups and routes distinct message types", () => {
    const d = diagram(
      [
        node("t", "kafka.topic", { partitions: 10 }),
        node("a", undefined, { concurrency: 1, latencyMs: 1000 }),
        node("b", undefined, { concurrency: 1, latencyMs: 100 }),
      ],
      [edge("t", "a", { group: "a", filter: ["Order*"] }), edge("t", "b", { group: "b", filter: ["Invoice"] })],
    );
    const input = traffic(
      {},
      {
        traffic: [
          { id: "o", node: "t", messageType: "Order", shape: { kind: "constant", ratePerSec: 2, durationMs: 1000 } },
          { id: "i", node: "t", messageType: "Invoice", shape: { kind: "constant", ratePerSec: 8, durationMs: 1000 } },
        ],
      },
    );
    const result = analyzeCapacity(d, input);
    expect(result.nodes.a.offered).toBe(2);
    expect(result.nodes.b.offered).toBe(8);
    expect(result.nodes.t.capacity).toBe(5);
    expect(result.nodes.t.utilization).toBe(2);
  });
  it("treats store arrivals as CDC only but store injection as source-like fan-out", () => {
    const d = diagram(
      [node("s", "client.user"), node("db", "postgres"), node("feed", "generic.email"), node("sync", "generic.email")],
      [edge("s", "db"), edge("db", "feed"), { ...edge("db", "sync"), kind: "sync" }],
    );
    const result = analyzeCapacity(d, traffic({ s: 10, db: 4 }));
    expect(result.nodes.db.offered).toBe(14);
    expect(result.nodes.feed.offered).toBe(14);
    expect(result.nodes.sync.offered).toBe(4);
  });
  it("uses setup, traffic/capacity multipliers and ignores sampling scale in real-unit analysis", () => {
    const d = diagram(
      [node("s", "client.user"), node("p", undefined, { replicas: 2, concurrency: 1, latencyMs: 1000 })],
      [edge("s", "p")],
    );
    const input = traffic(
      { s: 3 },
      { scale: 50, multipliers: { traffic: 2, capacity: 1.5 }, setup: { props: { p: { replicas: 3 } } } },
    );
    const result = analyzeCapacity(d, input);
    expect(result.nodes.p).toMatchObject({ capacity: 5, offered: 6, replicas: 5, utilization: 1.2 });
  });
  it("falls back to free-play source rates without a simulation", () => {
    const d = diagram([node("s", "client.user", { ratePerSec: 7 }), node("p")], [edge("s", "p")]);
    expect(analyzeCapacity(d).nodes.p.offered).toBe(7);
    expect(analyzeCapacity(d, traffic({})).nodes.p.offered).toBe(0);
  });
  it("reports zero capacity, infinite utilization and a ready-consumer suggestion for retained brokers", () => {
    const result = analyzeCapacity(diagram([node("q", "generic.queue")]), traffic({ q: 10 }));
    expect(result.nodes.q).toMatchObject({ capacity: 0, utilization: Infinity });
    expect(result.suggestion).toContain("ready consumer");
  });
  it("handles down/paused nodes and zero-concurrency processors without NaN", () => {
    const d = diagram([node("p", undefined, { concurrency: 0 }), node("q", undefined, { status: "down" })]);
    const result = analyzeCapacity(d, traffic({ p: 2, q: 3 }));
    expect(result.nodes.p.utilization).toBe(Infinity);
    expect(result.nodes.q.utilization).toBe(Infinity);
    const idle = analyzeCapacity(d, traffic({}));
    expect(idle.nodes.p.utilization).toBe(0);
  });
  it("takes a run's current statuses over the setup's and the diagram's", () => {
    const d = diagram([node("api"), node("pay", undefined, { status: "down" })], [edge("api", "pay")]);
    const sim = traffic({ api: 10 }, { setup: { status: { api: "paused" } } });
    const planned = analyzeCapacity(d, sim);
    expect(planned.nodes.api.capacity).toBe(0);
    expect(planned.nodes.pay.capacity).toBe(0);
    const live = analyzeCapacity(d, sim, { status: { api: "up", pay: "down" } });
    expect(live.nodes.api.capacity).toBeGreaterThan(0);
    expect(live.nodes.pay).toMatchObject({ capacity: 0, utilization: Infinity, offered: 10 });
    const revived = analyzeCapacity(d, sim, { status: { api: "up", pay: "up" } });
    expect(revived.nodes.pay.utilization).toBeLessThan(1);
    // Nodes the run doesn't mention keep their planned status.
    expect(analyzeCapacity(d, sim, { status: {} }).nodes.pay.capacity).toBe(0);
  });
  it("has no bottleneck without traffic and treats zero-latency processors as unlimited", () => {
    const d = diagram([node("p", undefined, { latencyMs: 0 })]);
    expect(analyzeCapacity(d, traffic({})).bottleneck).toBeUndefined();
    expect(analyzeCapacity(d, traffic({ p: 100 })).nodes.p.capacity).toBe(Infinity);
  });
  it("excludes inferred/explicit DLQ paths and honors explicit opt-out", () => {
    const d = diagram(
      [node("q", "generic.queue"), node("p"), node("dlq", "postgres")],
      [edge("q", "p"), edge("q", "dlq")],
    );
    expect(analyzeCapacity(d, traffic({ q: 10 })).nodes.dlq.offered).toBe(0);
    d.edges[1].props!.dlq = false;
    expect(analyzeCapacity(d, traffic({ q: 10 })).nodes.dlq.offered).toBeGreaterThan(0);
  });
  it("converges attenuating cycles using a fixed point", () => {
    const d = diagram([node("p", undefined, { latencyMs: 0 })], [edge("p", "p", { share: 0.5 })]);
    const result = analyzeCapacity(d, traffic({ p: 10 }));
    expect(result.converged).toBe(true);
    expect(result.nodes.p.offered).toBeCloseTo(20, 5);
  });
  it("caps unbounded cycles and signals uncertainty without hanging", () => {
    const d = diagram([node("p", undefined, { latencyMs: 0 })], [edge("p", "p")]);
    const result = analyzeCapacity(d, traffic({ p: 10 }));
    expect(result.converged).toBe(false);
    expect(result.iterations).toBe(256);
    expect(result.suggestion).toContain("did not converge");
    expect(Number.isFinite(result.nodes.p.offered)).toBe(true);
  });
  it("ignores dangling/duplicate edges, unknown entries and malformed numerical props", () => {
    const d = diagram(
      [node("s", "client.user"), node("p", undefined, { latencyMs: NaN, replicas: -2 })],
      [edge("s", "p"), edge("s", "p"), edge("missing", "p")],
    );
    const result = analyzeCapacity(d, traffic({ s: 10, missing: 200 }));
    expect(result.nodes.p.offered).toBe(10);
    expect(result.nodes.p.capacity).toBe(16);
  });
});

describe("analytic utilization versus simulation", () => {
  it.each([1, 5])("a direct processor at scale %s is within 20%% of the analytic rate", (scale) => {
    const d = diagram(
      [node("s", "client.user"), node("p", undefined, { replicas: 2, concurrency: 5, latencyMs: 1000 })],
      [edge("s", "p")],
    );
    const input = traffic({ s: 6 }, { scale, durationMs: 60000 });
    const analytic = analyzeCapacity(d, input).nodes.p;
    const run = createSimulationRun(d, input);
    run.step(40000);
    const initial = run.engine.frame().nodes.p.processed;
    run.step(20000);
    const utilization = ((run.engine.frame().nodes.p.processed - initial) * scale) / 20 / analytic.capacity;
    expect(Math.abs(utilization - analytic.utilization) / analytic.utilization).toBeLessThan(0.2);
    expect(analytic.utilization).toBe(0.6);
  });
  it.each([1, 2])("a partition-limited consumer at scale %s is within 20%%", (scale) => {
    const d = diagram(
      [
        node("t", "kafka.topic", { partitions: 2 }),
        node("p", undefined, { replicas: 6, concurrency: 2, latencyMs: 1000 }),
      ],
      [edge("t", "p")],
    );
    const input = traffic({ t: 3.2 }, { scale, durationMs: 60000 });
    const analytic = analyzeCapacity(d, input).nodes.p;
    const run = createSimulationRun(d, input);
    run.step(40000);
    const initial = run.engine.frame().nodes.p.processed;
    run.step(20000);
    const utilization = ((run.engine.frame().nodes.p.processed - initial) * scale) / 20 / analytic.capacity;
    expect(Math.abs(utilization - analytic.utilization) / analytic.utilization).toBeLessThan(0.2);
    expect(analytic.utilization).toBe(0.8);
    expect(analytic.idleReplicas).toBe(4);
  });
});

describe("capacity fixed-point boundaries", () => {
  it("caps amplifying fan-out and reports cycle uncertainty", () => {
    const d = diagram([node("p", undefined, { latencyMs: 0 })], [edge("p", "p"), edge("p", "p", {}, "second")]);
    const result = analyzeCapacity(d, traffic({ p: 10 }));
    expect(result.converged).toBe(false);
    expect(result.nodes.p.offered).toBe(1e12);
  });
  it("uses the largest assignment for multiple subscriptions, reserving one shared fleet", () => {
    const d = diagram(
      [
        node("a", "kafka.topic", { partitions: 2 }),
        node("b", "kafka.topic", { partitions: 3 }),
        node("p", undefined, { replicas: 6, concurrency: 2, latencyMs: 1000 }),
      ],
      [edge("a", "p"), edge("b", "p")],
    );
    const result = analyzeCapacity(d, traffic({ a: 2, b: 3 }));
    expect(result.nodes.p).toMatchObject({ activeReplicas: 3, idleReplicas: 3, capacity: 6, offered: 5 });
  });
  it("coalesces a shared group once while distinct groups still copy", () => {
    const d = diagram(
      [
        node("t", "kafka.topic", { partitions: 6 }),
        node("a", undefined, { replicas: 2 }),
        node("b", undefined, { replicas: 2 }),
      ],
      [edge("t", "a", { group: "g" }), edge("t", "b", { group: "g" }), edge("t", "a", { group: "other" }, "other")],
    );
    const result = analyzeCapacity(d, traffic({ t: 10 }));
    expect(result.nodes.a.offered).toBe(15);
    expect(result.nodes.b.offered).toBe(5);
  });
});
