import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../../model/types";
import kafka from "../../examples/kafka-order-pipeline.json";
import { applyOps } from "../index";
import { toOps } from "./compactOps";
import { perfBudget } from "../../test/perfBudget";

const KAFKA = kafka as unknown as DiagramFile;
const EMPTY: DiagramFile = { format: "diagrams/v1", title: "t", nodes: [], edges: [] };
const reply = (ops: object[]) => JSON.stringify({ summary: "s", ops });
type Scope = { id: string; label: string; kind: "node" }[];

/** The reply's ops applied to `diagram`: the edges as "from label -> to label". */
function apply(diagram: DiagramFile, ops: object[], ctx: { request?: string; scope?: Scope } = {}) {
  const r = toOps(reply(ops), { diagram, ...ctx });
  if (!r.ok) throw new Error(r.error);
  const out = applyOps(diagram, r.ops);
  if (!out.ok) throw new Error(out.errors[0]?.error);
  const label = new Map(out.diagram.nodes.map((n) => [n.id, n.label]));
  return {
    diagram: out.diagram,
    ops: r.ops,
    edges: out.diagram.edges.map((e) => `${label.get(e.from)} -> ${label.get(e.to)}`),
    node: (l: string) => out.diagram.nodes.find((n) => n.label === l),
  };
}
const error = (diagram: DiagramFile, ops: object[], ctx: { request?: string; scope?: Scope } = {}) => {
  const r = toOps(reply(ops), { diagram, ...ctx });
  return r.ok ? null : r.error;
};

describe("toOps: the format", () => {
  it("maps each op onto the core's ops, existing references pinned to ids", () => {
    const r = toOps(
      reply([
        { op: "add", key: "c", kind: "Redis cache", label: "cache", sublabel: "orders" },
        { op: "connect", from: "Order service", to: "c", flow: "request" },
        { op: "rename", target: "Order service", label: "Orders" },
        { op: "change_kind", target: "Orders database", kind: "MongoDB" },
        { op: "remove", target: "Order service -> Orders database" },
        {
          op: "insert_between",
          key: "r",
          kind: "queue",
          label: "relay",
          from: "Payments service",
          to: "Payment ledger",
        },
      ]),
      { diagram: KAFKA },
    );
    expect(r).toEqual({
      ok: true,
      summary: "s",
      ops: [
        { op: "add_node", kind: "Redis cache", label: "cache", key: "~c", sublabel: "orders" },
        { op: "connect", from: "orders", to: "~c", kind: "sync" },
        { op: "update", target: "orders", label: "Orders" },
        { op: "update", target: "order-db", kind: "MongoDB" },
        { op: "remove", targets: ["orders -> order-db"] },
        { op: "insert_between", from: "payments", to: "payment-db", kind: "queue", label: "relay", key: "~r" },
      ],
    });
  });

  it("says what's missing, op by op", () => {
    expect(error(EMPTY, [])).toBe("The reply has no ops.");
    expect(toOps("not json", { diagram: EMPTY })).toEqual({ ok: false, error: "The reply wasn't JSON." });
    expect(toOps("{}", { diagram: EMPTY })).toMatchObject({ error: 'The reply needs an "ops" array.' });
    expect(error(EMPTY, [{ op: "add", label: "x" }])).toBe('Op 1 (add) needs "kind" and "label".');
    expect(error(EMPTY, [{ op: "rename", target: "x" }])).toBe('Op 1 (rename) needs "target" and the new "label".');
    expect(error(EMPTY, [{ op: "insert_between", kind: "x", label: "y" }])).toMatch(/needs "kind", "label", "from"/);
    expect(error(EMPTY, [{ op: "fly" }])).toMatch(/"op" must be one of/);
    expect(
      error(
        EMPTY,
        Array.from({ length: 17 }, () => ({ op: "remove", target: "x" })),
      ),
    ).toBe("Use at most 16 ops.");
  });
});

describe("toOps: keys", () => {
  it("live where no element id can, so they never collide with ids made in the same batch", () => {
    // "cache-1" is the id the core gives the first Redis cache; as a key it must still mean the worker.
    const { edges } = apply(EMPTY, [
      { op: "add", key: "cache-1", kind: "Go service", label: "Worker" },
      { op: "add", key: "c", kind: "Redis cache", label: "Cache" },
      { op: "connect", from: "cache-1", to: "c" },
    ]);
    expect(edges).toEqual(["Worker -> Cache"]);
  });

  it("a key that is already an element's id or label is an error, for the retry to fix", () => {
    const withBoundary = {
      ...KAFKA,
      groups: [{ id: "boundary-1", label: "Cloud", x: 0, y: 0, width: 10, height: 10 }],
    } as DiagramFile;
    expect(error(withBoundary, [{ op: "add", key: "boundary-1", kind: "Go service", label: "Worker" }])).toMatch(
      /Key "boundary-1" is already an element's id or label/,
    );
    expect(error(KAFKA, [{ op: "add", key: "payments", kind: "queue", label: "q" }])).toMatch(/already an element/);
    expect(error(KAFKA, [{ op: "add", key: "Order service", kind: "queue", label: "q" }])).toMatch(
      /already an element/,
    );
    expect(
      error(EMPTY, [
        { op: "add", key: "a", kind: "queue", label: "q1" },
        { op: "add", key: "A", kind: "queue", label: "q2" },
      ]),
    ).toMatch(/used twice/);
  });
});

describe("toOps: reference precedence", () => {
  it("existing exact labels win over identical same-reply labels", () => {
    const { diagram } = apply(KAFKA, [
      { op: "add", key: "copy", kind: "Go service", label: "Payments service" },
      { op: "rename", target: "Payments service", label: "Billing service" },
    ]);
    expect(diagram.nodes.find((n) => n.id === "payments")?.label).toBe("Billing service");
    expect(diagram.nodes.filter((n) => n.label === "Payments service")).toHaveLength(1);
  });

  it("a new key that names an existing label in another case is an error, not a self-loop", () => {
    const api: DiagramFile = {
      ...EMPTY,
      nodes: [{ id: "svc", stencil: "service.node", label: "API", x: 0, y: 0 }],
    };
    expect(
      error(api, [
        { op: "add", key: "api", kind: "Go service", label: "API v2" },
        { op: "connect", from: "API", to: "api" },
      ]),
    ).toMatch(/Key "api" is already an element's id or label/);
    // With its own key, both ends keep their meaning.
    const { edges } = apply(api, [
      { op: "add", key: "v2", kind: "Go service", label: "API v2" },
      { op: "connect", from: "API", to: "v2" },
    ]);
    expect(edges).toEqual(["API -> API v2"]);
  });

  it("a name both an existing node and a new node answer to (ignoring case) is an error, not a pick", () => {
    expect(
      error(KAFKA, [
        { op: "add", kind: "queue", label: "payments service" },
        { op: "connect", from: "PAYMENTS SERVICE", to: "Payment ledger" },
      ]),
    ).toMatch(/could be an existing element or a new node/);
    expect(
      error(EMPTY, [
        { op: "add", kind: "Python service", label: "A" },
        { op: "add", kind: "Python service", label: "B" },
        { op: "connect", from: "Python service", to: "A" },
      ]),
    ).toMatch(/kind of 2 new nodes/);
  });

  it("new nodes by key, by label in any case, by kind and by a shared word", () => {
    const { edges } = apply(EMPTY, [
      { op: "add", key: "job", kind: "Python service", label: "Indexer" },
      { op: "add", key: "db", kind: "PostgreSQL", label: "Index" },
      { op: "add", key: "q", kind: "SQS", label: "Inbox" },
      { op: "connect", from: "job", to: "INDEX" },
      { op: "connect", from: "SQS", to: "indexer" },
    ]);
    expect(edges).toEqual(["Indexer -> Index", "Inbox -> Indexer"]);
    const word = apply(EMPTY, [
      { op: "add", kind: "Python service", label: "Job runner" },
      { op: "add", kind: "pg", label: "Store" },
      { op: "connect", from: "Python job", to: "pg" },
    ]);
    expect(word.edges).toEqual(["Job runner -> Store"]);
  });

  it("a unique new node is never swapped for an unrelated existing one", () => {
    const { edges } = apply(EMPTY, [
      { op: "add", kind: "Container Apps", label: "API" },
      { op: "add", kind: "Cosmos DB", label: "State" },
      { op: "connect", from: "Container Apps", to: "Cosmos DB" },
    ]);
    expect(edges).toEqual(["API -> State"]);
  });
});

describe("toOps: hard edits", () => {
  it("insert_between goes through the core: the old connection's meaning carries over", () => {
    const { edges, diagram, node } = apply(KAFKA, [
      {
        op: "insert_between",
        key: "r",
        kind: "queue",
        label: "Relay",
        from: "orders.created.v1",
        to: "Inventory service",
      },
    ]);
    expect(edges).not.toContain("orders.created.v1 -> Inventory service");
    const relay = node("Relay")!;
    const first = diagram.edges.find((e) => e.to === relay.id)!;
    const second = diagram.edges.find((e) => e.from === relay.id)!;
    expect(first).toMatchObject({ kind: "async", label: "Reserve inventory" });
    expect(first.props).toMatchObject({ filter: ["OrderPlaced"], group: "inventory-reservations" });
    expect(second.props).toMatchObject({ filter: ["OrderPlaced"], group: "inventory-reservations" });
  });

  it('a "between" answered with plain connects becomes insert_between, keeping the connection\'s kind', () => {
    const { edges, diagram, node } = apply(
      KAFKA,
      [
        { op: "add", key: "c", kind: "Redis cache", label: "Orders cache" },
        { op: "remove", target: "Order service -> Orders database" },
        { op: "connect", from: "Order service", to: "c", flow: "message" },
        { op: "connect", from: "c", to: "Orders database", flow: "message" },
      ],
      { request: "Put a Redis cache between Order service and Orders database" },
    );
    expect(edges).not.toContain("Order service -> Orders database");
    expect(edges).toEqual(expect.arrayContaining(["Order service -> Orders cache", "Orders cache -> Orders database"]));
    const cache = node("Orders cache")!;
    expect(diagram.edges.filter((e) => e.from === cache.id || e.to === cache.id).map((e) => e.kind)).toEqual([
      "sync",
      "sync",
    ]);
    // Without "between", plain connects stay plain and nothing is removed.
    const plain = apply(KAFKA, [
      { op: "add", key: "c", kind: "Redis cache", label: "Orders cache" },
      { op: "connect", from: "Order service", to: "c" },
      { op: "connect", from: "c", to: "Orders database" },
    ]);
    expect(plain.edges).toContain("Order service -> Orders database");
  });

  it("an insert_between plus a remove of the same connection: the remove is dropped", () => {
    const { edges } = apply(KAFKA, [
      { op: "remove", target: "Order service -> Orders database" },
      {
        op: "insert_between",
        kind: "Redis cache",
        label: "Orders cache",
        from: "Order service",
        to: "Orders database",
      },
    ]);
    expect(edges).toEqual(expect.arrayContaining(["Order service -> Orders cache", "Orders cache -> Orders database"]));
  });

  it("a rename with only a kind is a kind change; a change_kind with only a label is a rename", () => {
    expect(
      apply(KAFKA, [{ op: "rename", target: "Orders database", kind: "MongoDB" }]).node("Orders database")?.stencil,
    ).toBe("mongodb");
    expect(
      apply(KAFKA, [{ op: "change_kind", target: "Payments service", label: "Billing service" }]).node(
        "Billing service",
      )?.stencil,
    ).toBe("service.go");
  });
});

describe("toOps: the selection", () => {
  const scope: Scope = [{ id: "payments", label: "Payments service", kind: "node" }];
  /** The connections touching the new queue. */
  const touchingRetry = (edges: string[]) => edges.filter((e) => e.includes("payments-retry"));

  it('"this" names the selected node', () => {
    const { edges } = apply(
      KAFKA,
      [
        { op: "add", key: "r", kind: "queue", label: "payments-retry" },
        { op: "connect", from: "this", to: "r" },
      ],
      { request: "Add a retry queue after this", scope },
    );
    expect(touchingRetry(edges)).toEqual(["Payments service -> payments-retry"]);
  });

  it('"after this" with a correct label-based connection adds nothing more', () => {
    const { edges } = apply(
      KAFKA,
      [
        { op: "add", key: "r", kind: "queue", label: "payments-retry" },
        { op: "connect", from: "Payments service", to: "r" },
      ],
      { request: "Add a retry queue after this", scope },
    );
    expect(touchingRetry(edges)).toEqual(["Payments service -> payments-retry"]);
  });

  it('"after this" replaces a reversed label-based connection, not adds a second one', () => {
    const { edges } = apply(
      KAFKA,
      [
        { op: "add", key: "r", kind: "queue", label: "payments-retry" },
        { op: "connect", from: "r", to: "Payments service" },
      ],
      { request: "Add a retry queue after this", scope },
    );
    expect(touchingRetry(edges)).toEqual(["Payments service -> payments-retry"]);
  });

  it('"before this" turns a connection drawn out of the selection, and connects a hanging node', () => {
    const turned = apply(
      KAFKA,
      [
        { op: "add", key: "g", kind: "API gateway", label: "Pay gateway" },
        { op: "connect", from: "Payments service", to: "g" },
      ],
      { request: "Put a gateway before this", scope },
    );
    expect(turned.edges.filter((e) => e.includes("Pay gateway"))).toEqual(["Pay gateway -> Payments service"]);
    const hanging = apply(KAFKA, [{ op: "add", kind: "queue", label: "payments-retry" }], {
      request: "Add a retry queue after this",
      scope,
    });
    expect(touchingRetry(hanging.edges)).toEqual(["Payments service -> payments-retry"]);
  });
});

describe("toOps: direction", () => {
  const nodes = [
    { op: "add", key: "j", kind: "Java service", label: "Worker" },
    { op: "add", key: "t", kind: "Kafka topic", label: "Events" },
  ];

  it.each([
    "Java consumes a Kafka topic",
    "The worker reads from a Kafka topic",
    "A Java service subscribes to the topic",
  ])("%s: the consumed pair drawn the wrong way round is turned", (request) => {
    expect(apply(EMPTY, [...nodes, { op: "connect", from: "j", to: "t" }], { request }).edges).toEqual([
      "Events -> Worker",
    ]);
  });

  it("only that pair: the other connections of a mixed request stay as drawn", () => {
    const withSqs = [...nodes, { op: "add", key: "q", kind: "SQS", label: "Outbox" }];
    const request = "Java consumes a Kafka topic and forwards events to SQS";
    // Right as it is.
    expect(
      apply(EMPTY, [...withSqs, { op: "connect", from: "t", to: "j" }, { op: "connect", from: "j", to: "q" }], {
        request,
      }).edges,
    ).toEqual(["Events -> Worker", "Worker -> Outbox"]);
    // The consumed pair turned, the forward left alone.
    expect(
      apply(EMPTY, [...withSqs, { op: "connect", from: "j", to: "t" }, { op: "connect", from: "j", to: "q" }], {
        request,
      }).edges,
    ).toEqual(["Events -> Worker", "Worker -> Outbox"]);
  });

  it("nothing is turned without a consume verb, or when the consumed thing isn't a queue, topic or stream", () => {
    const wrong = [...nodes, { op: "connect", from: "j", to: "t" }];
    expect(apply(EMPTY, wrong, { request: "Java publishes to a Kafka topic" }).edges).toEqual(["Worker -> Events"]);
    const db = [
      { op: "add", key: "j", kind: "Java service", label: "Worker" },
      { op: "add", key: "d", kind: "PostgreSQL", label: "DB" },
      { op: "connect", from: "j", to: "d" },
    ];
    expect(apply(EMPTY, db, { request: "Java consumes data from Postgres" }).edges).toEqual(["Worker -> DB"]);
  });
});

describe("toOps: cost", () => {
  it("one reference index per reply: a big diagram stays fast", () => {
    const n = 5000;
    const big: DiagramFile = {
      ...EMPTY,
      nodes: Array.from({ length: n }, (_, i) => ({
        id: `n${i}`,
        stencil: i % 2 ? "kafka.topic" : "service.java",
        label: `Node ${i}`,
        x: (i % 100) * 300,
        y: Math.floor(i / 100) * 200,
      })),
      edges: Array.from({ length: 20000 }, (_, i) => ({ id: `e${i}`, from: `n${i % n}`, to: `n${(i * 7 + 1) % n}` })),
    };
    const ops = Array.from({ length: 16 }, (_, i) => ({
      op: "connect",
      from: `Node ${2 * i}`,
      to: `Node ${2 * i + 1}`,
    }));
    const t0 = performance.now();
    const r = toOps(reply(ops), { diagram: big, request: "Node 0 consumes Node 1 and the rest" });
    const ms = performance.now() - t0;
    expect(r.ok).toBe(true);
    expect(ms).toBeLessThan(perfBudget(400));
  });
});
