import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../../model/types";
import kafka from "../../examples/kafka-order-pipeline.json";
import { applyOps } from "../index";
import { toOps } from "./compactOps";

const KAFKA = kafka as unknown as DiagramFile;
const EMPTY: DiagramFile = { format: "diagrams/v1", title: "t", nodes: [], edges: [] };
const reply = (ops: object[]) => JSON.stringify({ summary: "s", ops });

/** The reply's ops applied to `diagram`: the edges as "from label -> to label". */
function apply(
  diagram: DiagramFile,
  ops: object[],
  ctx: { request?: string; scope?: { id: string; label: string; kind: "node" }[] } = {},
) {
  const r = toOps(reply(ops), { diagram, ...ctx });
  if (!r.ok) throw new Error(r.error);
  const out = applyOps(diagram, r.ops);
  if (!out.ok) throw new Error(out.errors[0]?.error);
  const label = new Map(out.diagram.nodes.map((n) => [n.id, n.label]));
  return {
    diagram: out.diagram,
    ops: r.ops,
    edges: out.diagram.edges.map((e) => `${label.get(e.from)} -> ${label.get(e.to)}`),
    stencil: (l: string) => out.diagram.nodes.find((n) => n.label === l)?.stencil,
  };
}

describe("toOps: the format", () => {
  it("maps each op onto the core's ops", () => {
    const r = toOps(
      reply([
        { op: "add", key: "c", kind: "Redis cache", label: "cache", sublabel: "orders" },
        { op: "connect", from: "Order service", to: "c", flow: "request" },
        { op: "rename", target: "Order service", label: "Orders" },
        { op: "change_kind", target: "Orders database", kind: "MongoDB" },
        { op: "remove", target: "Order service -> Orders database" },
      ]),
      { diagram: KAFKA },
    );
    expect(r).toEqual({
      ok: true,
      summary: "s",
      ops: [
        { op: "add_node", kind: "Redis cache", label: "cache", key: "c", sublabel: "orders" },
        { op: "connect", from: "Order service", to: "c", kind: "sync" },
        { op: "update", target: "Order service", label: "Orders" },
        { op: "update", target: "Orders database", kind: "MongoDB" },
        { op: "remove", targets: ["Order service -> Orders database"] },
      ],
    });
  });

  it("says what's missing, op by op", () => {
    const ctx = { diagram: EMPTY };
    expect(toOps("not json", ctx)).toEqual({ ok: false, error: "The reply wasn't JSON." });
    expect(toOps("{}", ctx)).toMatchObject({ error: 'The reply needs an "ops" array.' });
    expect(toOps(reply([]), ctx)).toMatchObject({ error: "The reply has no ops." });
    expect(toOps(reply([{ op: "add", label: "x" }]), ctx)).toMatchObject({
      error: 'Op 1 (add) needs "kind" and "label".',
    });
    expect(toOps(reply([{ op: "rename", target: "x" }]), ctx)).toMatchObject({
      error: 'Op 1 (rename) needs "target" and the new "label".',
    });
    expect(toOps(reply([{ op: "insert_between", kind: "x", label: "y" }]), ctx)).toMatchObject({ ok: false });
    expect(toOps(reply([{ op: "fly" }]), ctx)).toMatchObject({ ok: false });
    expect(toOps(reply(Array.from({ length: 17 }, () => ({ op: "remove", target: "x" }))), ctx)).toMatchObject({
      error: "Use at most 16 ops.",
    });
  });

  it("gives every added node a key that can't collide with an existing id", () => {
    const r = toOps(reply([{ op: "add", kind: "Redis cache", label: "payments" }]), { diagram: KAFKA });
    expect(r.ok && r.ops[0]).toMatchObject({ op: "add_node", key: "payments-new" });
  });
});

describe("toOps: references to nodes of the same reply", () => {
  it("by key, by label in any case, and by kind", () => {
    const { edges } = apply(EMPTY, [
      { op: "add", key: "job", kind: "Python service", label: "Indexer" },
      { op: "add", key: "db", kind: "PostgreSQL", label: "Index" },
      { op: "add", key: "q", kind: "SQS", label: "Inbox" },
      { op: "connect", from: "job", to: "INDEX" },
      { op: "connect", from: "SQS", to: "indexer" },
    ]);
    expect(edges).toEqual(["Indexer -> Index", "Inbox -> Indexer"]);
  });

  it('by a word of its label or kind: "Python job" is the node added as a Python service', () => {
    const { edges } = apply(EMPTY, [
      { op: "add", kind: "Python service", label: "Job runner" },
      { op: "add", kind: "pg", label: "Store" },
      { op: "connect", from: "Python job", to: "pg" },
    ]);
    expect(edges).toEqual(["Job runner -> Store"]);
  });

  it("an existing node's exact label wins over a fuzzy new one", () => {
    const { edges } = apply(KAFKA, [
      { op: "add", key: "inv-dlq", kind: "queue", label: "Inventory DLQ" },
      { op: "connect", from: "Inventory service", to: "inv-dlq" },
    ]);
    expect(edges).toContain("Inventory service -> Inventory DLQ");
  });

  it("a unique new node is never swapped for an unrelated existing one", () => {
    // "Container Apps" is the kind of the node added as "API"; the core alone would fail or guess.
    const { edges } = apply(EMPTY, [
      { op: "add", kind: "Container Apps", label: "API" },
      { op: "add", kind: "Cosmos DB", label: "State" },
      { op: "connect", from: "Container Apps", to: "Cosmos DB" },
    ]);
    expect(edges).toEqual(["API -> State"]);
  });
});

describe("toOps: hard edits", () => {
  it("insert_between removes the direct connection and goes through the new node", () => {
    const { edges, stencil } = apply(KAFKA, [
      {
        op: "insert_between",
        key: "c",
        kind: "Redis cache",
        label: "Orders cache",
        from: "Order service",
        to: "Orders database",
      },
    ]);
    expect(edges).not.toContain("Order service -> Orders database");
    expect(edges).toEqual(expect.arrayContaining(["Order service -> Orders cache", "Orders cache -> Orders database"]));
    expect(stencil("Orders cache")).toBe("redis.cache");
  });

  it("insert_between follows the existing connection when the ends are named the other way round", () => {
    const { edges, diagram } = apply(KAFKA, [
      {
        op: "insert_between",
        kind: "Redis cache",
        label: "Orders cache",
        from: "Orders database",
        to: "Order service",
      },
    ]);
    expect(edges).toEqual(expect.arrayContaining(["Order service -> Orders cache", "Orders cache -> Orders database"]));
    // The new connections keep the old one's kind (a request).
    const cache = diagram.nodes.find((n) => n.label === "Orders cache")!;
    expect(diagram.edges.filter((e) => e.from === cache.id || e.to === cache.id).map((e) => e.kind)).toEqual([
      "sync",
      "sync",
    ]);
  });

  it("a rename with only a kind is a kind change; a change_kind with only a label is a rename", () => {
    expect(
      apply(KAFKA, [{ op: "rename", target: "Orders database", kind: "MongoDB" }]).stencil("Orders database"),
    ).toBe("mongodb");
    expect(
      apply(KAFKA, [{ op: "change_kind", target: "Payments service", label: "Billing service" }]).stencil(
        "Billing service",
      ),
    ).toBe("service.go");
  });

  it('"between", answered with plain connects, still drops the direct connection', () => {
    const { edges } = apply(
      KAFKA,
      [
        { op: "add", key: "c", kind: "Redis cache", label: "Orders cache" },
        { op: "connect", from: "Order service", to: "c", flow: "request" },
        { op: "connect", from: "c", to: "Orders database", flow: "request" },
      ],
      { request: "Put a Redis cache between Order service and Orders database" },
    );
    expect(edges).not.toContain("Order service -> Orders database");
    expect(edges).toEqual(expect.arrayContaining(["Order service -> Orders cache", "Orders cache -> Orders database"]));
    // Without "between", nothing is removed.
    const plain = apply(KAFKA, [
      { op: "add", key: "c", kind: "Redis cache", label: "Orders cache" },
      { op: "connect", from: "Order service", to: "c" },
      { op: "connect", from: "c", to: "Orders database" },
    ]);
    expect(plain.edges).toContain("Order service -> Orders database");
  });

  it("change_kind swaps the stencil, keeping the label and the connections", () => {
    const before = KAFKA.edges.filter((e) => e.from === "order-db" || e.to === "order-db").length;
    const { diagram } = apply(KAFKA, [{ op: "change_kind", target: "Orders database", kind: "MongoDB" }]);
    const n = diagram.nodes.find((x) => x.id === "order-db")!;
    expect(n).toMatchObject({ stencil: "mongodb", label: "Orders database" });
    expect(diagram.edges.filter((e) => e.from === "order-db" || e.to === "order-db")).toHaveLength(before);
  });
});

describe("toOps: the selection", () => {
  const scope = [{ id: "payments", label: "Payments service", kind: "node" as const }];

  it('"this" names the selected node', () => {
    const { edges } = apply(
      KAFKA,
      [
        { op: "add", key: "r", kind: "queue", label: "payments-retry" },
        { op: "connect", from: "this", to: "r" },
      ],
      { request: "Add a retry queue after this", scope },
    );
    expect(edges).toContain("Payments service -> payments-retry");
  });

  it('"after this" connects a new node the reply left hanging, from the selection', () => {
    const { edges } = apply(KAFKA, [{ op: "add", kind: "queue", label: "payments-retry" }], {
      request: "Add a retry queue after this",
      scope,
    });
    expect(edges).toContain("Payments service -> payments-retry");
  });

  it('"after this" turns a connection drawn into the selection; "before this" the other way', () => {
    const after = apply(
      KAFKA,
      [
        { op: "add", key: "r", kind: "queue", label: "payments-retry" },
        { op: "connect", from: "r", to: "Payments service" },
      ],
      { request: "Add a retry queue after this", scope },
    );
    expect(after.edges).toContain("Payments service -> payments-retry");
    const before = apply(KAFKA, [{ op: "add", kind: "API gateway", label: "Pay gateway" }], {
      request: "Put a gateway before this",
      scope,
    });
    expect(before.edges).toContain("Pay gateway -> Payments service");
  });
});

describe("toOps: direction", () => {
  const consume = [
    { op: "add", key: "j", kind: "Java service", label: "Worker" },
    { op: "add", key: "t", kind: "Kafka topic", label: "Events" },
    { op: "connect", from: "j", to: "t" },
  ];

  it.each([
    "Java consumes a Kafka topic",
    "An Azure function consumes a Service Bus queue",
    "The worker reads from a Kafka topic",
    "A Java service subscribes to the topic",
  ])("%s: a service drawn into the topic it reads is turned round", (request) => {
    expect(apply(EMPTY, consume, { request }).edges).toEqual(["Events -> Worker"]);
  });

  it("leaves mixed or produce-only requests, and other pairs, as drawn", () => {
    expect(apply(EMPTY, consume, { request: "Java publishes to a Kafka topic" }).edges).toEqual(["Worker -> Events"]);
    expect(apply(EMPTY, consume, { request: "Java consumes a topic and writes to it" }).edges).toEqual([
      "Worker -> Events",
    ]);
    const db = [
      { op: "add", key: "j", kind: "Java service", label: "Worker" },
      { op: "add", key: "d", kind: "PostgreSQL", label: "DB" },
      { op: "connect", from: "j", to: "d" },
    ];
    expect(apply(EMPTY, db, { request: "Java consumes data from Postgres" }).edges).toEqual(["Worker -> DB"]);
  });
});
