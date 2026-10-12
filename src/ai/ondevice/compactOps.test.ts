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
        Array.from({ length: 9 }, () => ({ op: "remove", target: "x" })),
      ),
    ).toBe("Use at most 6 ops.");
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
    const ops = Array.from({ length: 6 }, (_, i) => ({
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

describe("round 2: the label wins over a wrong kind word, when the request names it", () => {
  const stencilOf = (request: string, kind: string, label: string, other: object[]) =>
    apply(EMPTY, [{ op: "add", key: "x", kind, label }, ...other], { request }).node(label)?.stencil;
  const partner = (kind: string, label: string, from: "x" | "y" = "x") => [
    { op: "add", key: "y", kind, label },
    from === "x" ? { op: "connect", from: "x", to: "y" } : { op: "connect", from: "y", to: "x" },
  ];

  it.each([
    // create-6, create-16, create-17, create-22, create-19, as the model answered them.
    [
      "An Azure function consumes a Service Bus queue",
      "Lambda",
      "Azure function",
      partner("Service Bus queue", "Jobs", "y"),
      "azure.functions",
    ],
    [
      "A mobile client calls an API gateway",
      "browser",
      "Mobile Client",
      partner("API gateway", "Gateway"),
      "client.mobile",
    ],
    [
      "Front Door routes to App Service",
      "Amazon API Gateway",
      "Front Door",
      partner("App Service", "Web app"),
      "azure.front-door",
    ],
    ["A scheduler starts a .NET worker", "Lambda", "Scheduler", partner(".NET service", "Worker"), "generic.scheduler"],
    ["Prometheus exports to Grafana", "Go service", "Prometheus", partner("Grafana", "Dashboards"), "prometheus"],
  ])("%s: kind %s, label %s", (request, kind, label, other, stencil) => {
    expect(stencilOf(request, kind, label, other)).toBe(stencil);
  });

  it("the kind stays for a label of the model's own, a generic label, or a kind the request names", () => {
    // "Orders API" isn't in the request; Node stays.
    expect(stencilOf("A browser calls an API", "Node.js API", "Orders API", partner("browser", "Web", "y"))).toBe(
      "service.node",
    );
    expect(stencilOf("Workers write to Postgres", ".NET service", "billing-worker", partner("PostgreSQL", "DB"))).toBe(
      "service.dotnet",
    );
    // A one-word generic label ("Events", "Cache") doesn't beat a specific kind.
    expect(
      stencilOf("Java consumes a Kafka topic and forwards events to SQS", "Kafka topic", "Events", [
        { op: "add", key: "j", kind: "Java service", label: "Worker" },
        { op: "add", key: "q", kind: "SQS", label: "Outbox" },
        { op: "connect", from: "x", to: "j" },
        { op: "connect", from: "j", to: "q" },
      ]),
    ).toBe("kafka.topic");
    expect(stencilOf("A Go service uses Redis cache", "Redis cache", "Cache", partner("Go service", "API", "y"))).toBe(
      "redis.cache",
    );
  });
});

describe("round 2: completeness", () => {
  it("into an empty diagram, every named component must be added and connected", () => {
    // create-12: only Redis.
    expect(
      error(EMPTY, [{ op: "add", key: "r", kind: "Redis cache", label: "Redis" }], {
        request: "A Go service uses Redis cache",
      }),
    ).toBe(
      "You added Redis but not the Go service, and nothing connects them. Add every component the request names and connect them.",
    );
    // create-28: one node only.
    expect(
      error(EMPTY, [{ op: "add", kind: "generic database", label: "DB" }], {
        request: "An unspecified component connects to a generic database",
      }),
    ).toMatch(/^You added DB but not the unspecified component/);
  });

  it("new nodes left unconnected in a request that relates things", () => {
    // create-21: both nodes, no connection.
    expect(
      error(
        EMPTY,
        [
          { op: "add", key: "d", kind: "IoT devices", label: "Devices" },
          { op: "add", key: "h", kind: "Event Hubs", label: "Hub" },
        ],
        { request: "IoT devices publish into Event Hubs" },
      ),
    ).toBe("You added Devices and Hub but nothing connects them. Connect every component the request names.");
    expect(
      error(KAFKA, [{ op: "add", key: "q", kind: "queue", label: "inventory-dlq" }], {
        request: "Add a dead-letter queue after Inventory service",
      }),
    ).toMatch(/^You added inventory-dlq but nothing connects it/);
  });

  it("stays quiet when nothing is missing, or the request relates nothing", () => {
    const full = [
      { op: "add", key: "s", kind: "service", label: "Notifier" },
      { op: "add", key: "e", kind: "email", label: "Email" },
      { op: "connect", from: "s", to: "e" },
    ];
    expect(error(EMPTY, full, { request: "A service delivers email" })).toBeNull();
    expect(
      error(KAFKA, [{ op: "add", kind: "Redis cache", label: "Cache" }], { request: "Add a Redis cache" }),
    ).toBeNull();
  });
});

describe("round 2: references the model gets wrong", () => {
  it("a connection from a node to itself is an error for the retry", () => {
    expect(
      error(
        EMPTY,
        [
          { op: "add", key: "ecs-dynamodb", kind: "DynamoDB", label: "Table" },
          { op: "connect", from: "ecs-dynamodb", to: "ecs-dynamodb" },
        ],
        { request: "An ECS workload persists to DynamoDB" },
      ),
    ).toBe("A connection can't start and end at the same node; add the missing component first.");
  });

  it("a component the request names, connected but never added, is added (create-15)", () => {
    const { edges, node } = apply(
      EMPTY,
      [
        { op: "add", key: "cosmos", kind: "Cosmos DB", label: "Container Cosmos DB" },
        { op: "connect", from: "Container Apps", to: "cosmos" },
      ],
      { request: "Container Apps accesses Cosmos DB" },
    );
    expect(node("Container Apps")?.stencil).toBe("azure.container-apps");
    expect(edges).toEqual(["Container Apps -> Container Cosmos DB"]);
  });

  it("…but not when one of the reply's new nodes is that component", () => {
    const { diagram } = apply(
      EMPTY,
      [
        { op: "add", kind: "Python", label: "Job" },
        { op: "add", kind: "pg", label: "pg" },
        { op: "connect", from: "Python job", to: "pg" },
      ],
      { request: "A Python job writes to pg" },
    );
    expect(diagram.nodes).toHaveLength(2);
  });

  it("…and a connection drawn against the request's verb is turned (reversed Container Apps)", () => {
    const { edges } = apply(
      EMPTY,
      [
        { op: "add", key: "cosmos", kind: "Cosmos DB", label: "State" },
        { op: "connect", from: "cosmos", to: "Container Apps" },
      ],
      { request: "Container Apps accesses Cosmos DB" },
    );
    expect(edges).toEqual(["Container Apps -> State"]);
  });

  it('only a confident match is added: "ECS workload" (medium) is left for the retry\'s feedback (create-25)', () => {
    const r = toOps(
      reply([
        { op: "add", key: "ddb", kind: "DynamoDB", label: "Table" },
        { op: "connect", from: "ddb", to: "ECS workload" },
      ]),
      { diagram: EMPTY, request: "An ECS workload persists to DynamoDB" },
    );
    // Not added for the model: the completeness check names it instead.
    expect(r).toMatchObject({
      ok: false,
      error: "You added Table but not the ECS workload. Add every component the request names and connect them.",
    });
  });

  it('"between X and Y" with only one side connected becomes insert_between', () => {
    for (const connect of [
      { op: "connect", from: "Order service", to: "c" },
      { op: "connect", from: "c", to: "Orders database" },
    ]) {
      const { edges } = apply(KAFKA, [{ op: "add", key: "c", kind: "Redis cache", label: "Orders cache" }, connect], {
        request: "Put a Redis cache between Order service and Orders database",
      });
      expect(edges).not.toContain("Order service -> Orders database");
      expect(edges).toEqual(
        expect.arrayContaining(["Order service -> Orders cache", "Orders cache -> Orders database"]),
      );
    }
  });

  it("a placeholder name from the examples is an error, unless the request or diagram has it", () => {
    expect(
      error(
        EMPTY,
        [
          { op: "add", key: "p", kind: "partner", label: "External partner" },
          { op: "add", key: "g", kind: "Batch Job", label: "sample-batch" },
          { op: "connect", from: "p", to: "g" },
        ],
        { request: "An external partner sends a webhook" },
      ),
    ).toMatch(/^Don't reuse names from the examples \("sample-batch"\)/);
    expect(
      error(EMPTY, [{ op: "add", key: "g", kind: "Batch Job", label: "sample-batch" }], {
        request: "Add sample-batch",
      }),
    ).toBeNull();
  });
});

describe("round 2 review: lookup never creates, repairs stay scoped", () => {
  it.each([
    ["rename", { op: "rename", target: "Redis cache", label: "Session cache" }, "Rename Redis cache to Session cache"],
    ["change_kind", { op: "change_kind", target: "Redis cache", kind: "Memcached" }, "Make Redis cache a Memcached"],
    ["remove", { op: "remove", target: "Redis cache" }, "Remove Redis cache"],
  ])("a missing %s target is an error for the retry, never a new node", (_name, op, request) => {
    const r = toOps(reply([op]), { diagram: KAFKA, request });
    expect(r.ok && r.ops.some((o) => o.op === "add_node")).toBe(false);
    expect(() => apply(KAFKA, [op], { request })).toThrow(/Unknown reference "Redis cache"/);
  });

  it("the between repair touches only the clause's component; other additions stay as they are", () => {
    const request =
      "Put a Redis cache between Order service and Orders database, and add an email sink after Order service";
    const { edges } = apply(
      KAFKA,
      [
        {
          op: "insert_between",
          key: "c",
          kind: "Redis cache",
          label: "Orders cache",
          from: "Order service",
          to: "Orders database",
        },
        { op: "add", key: "mail", kind: "email", label: "Email" },
        { op: "connect", from: "Order service", to: "mail" },
      ],
      { request },
    );
    expect(edges).toEqual(
      expect.arrayContaining([
        "Order service -> Orders cache",
        "Orders cache -> Orders database",
        "Order service -> Email",
      ]),
    );
    // The cache connected on one side only: repaired; the email node untouched.
    const oneSided = apply(
      KAFKA,
      [
        { op: "add", key: "c", kind: "Redis cache", label: "Orders cache" },
        { op: "connect", from: "Order service", to: "c" },
        { op: "add", key: "mail", kind: "email", label: "Email" },
        { op: "connect", from: "Order service", to: "mail" },
      ],
      { request },
    );
    expect(oneSided.edges).toEqual(
      expect.arrayContaining([
        "Order service -> Orders cache",
        "Orders cache -> Orders database",
        "Order service -> Email",
      ]),
    );
    expect(oneSided.edges).not.toContain("Order service -> Orders database");
  });
});

describe("round 2 review: completeness counts components, not mentions", () => {
  const goRedisPg = [
    { op: "add", key: "go", kind: "Go service", label: "API" },
    { op: "add", key: "r", kind: "Redis cache", label: "Cache" },
    { op: "add", key: "pg", kind: "PostgreSQL", label: "DB" },
  ];
  it.each([
    [
      "A Go service uses Redis cache and Redis cache writes to PostgreSQL",
      [
        ["go", "r"],
        ["r", "pg"],
      ],
    ],
    [
      "A Go service writes to PostgreSQL and the Go service uses Redis cache",
      [
        ["go", "pg"],
        ["go", "r"],
      ],
    ],
    [
      "A Go service writes to PostgreSQL and the service uses Redis cache",
      [
        ["go", "pg"],
        ["go", "r"],
      ],
    ],
  ])("accepts repeated references to one component: %s", (request, links) => {
    const { diagram, edges } = apply(
      EMPTY,
      [...goRedisPg, ...links.map(([from, to]) => ({ op: "connect", from, to }))],
      { request: request as string },
    );
    expect(diagram.nodes).toHaveLength(3);
    expect(edges).toHaveLength(2);
  });

  it('keeps separate components separate: "billing and shipping consumers" is two', () => {
    const request = "A Kafka topic feeds billing and shipping consumers";
    expect(
      error(
        EMPTY,
        [
          { op: "add", key: "t", kind: "Kafka topic", label: "Orders" },
          { op: "add", key: "b", kind: ".NET service", label: "Billing" },
          { op: "connect", from: "t", to: "b" },
        ],
        { request },
      ),
    ).toMatch(/but not the shipping consumers/);
    expect(
      error(
        EMPTY,
        [
          { op: "add", key: "t", kind: "Kafka topic", label: "Orders" },
          { op: "add", key: "b", kind: ".NET service", label: "Billing" },
          { op: "add", key: "s", kind: "Python service", label: "Shipping" },
          { op: "connect", from: "t", to: "b" },
          { op: "connect", from: "t", to: "s" },
        ],
        { request },
      ),
    ).toBeNull();
  });

  it("honors a request to leave a node unconnected, and doesn't hold an unrelated addition to a connection", () => {
    const connectAndAdd = [
      { op: "connect", from: "Payments service", to: "Commerce metrics" },
      { op: "add", key: "c", kind: "Redis cache", label: "Cache" },
    ];
    expect(
      error(KAFKA, connectAndAdd, {
        request: "Connect Payments service to Commerce metrics and add a Redis cache, but do not connect the cache yet",
      }),
    ).toBeNull();
    expect(
      error(KAFKA, connectAndAdd, { request: "Connect Payments service to Commerce metrics and add a Redis cache" }),
    ).toBeNull();
  });
});

describe("round 2 review: one normalized node", () => {
  it("later decisions see the corrected kind: the consumed topic is turned round", () => {
    const { edges, node } = apply(
      EMPTY,
      [
        { op: "add", key: "t", kind: "PostgreSQL", label: "Kafka topic" },
        { op: "add", key: "j", kind: "Java service", label: "Worker" },
        { op: "connect", from: "j", to: "t" },
      ],
      { request: "A Java service consumes a Kafka topic" },
    );
    expect(node("Kafka topic")?.stencil).toBe("kafka.topic");
    expect(edges).toEqual(["Kafka topic -> Worker"]);
  });

  it("does not auto-add a node after correcting its kind", () => {
    const { diagram, edges } = apply(
      EMPTY,
      [
        { op: "add", key: "f", kind: "Lambda", label: "Azure function" },
        { op: "add", key: "q", kind: "Service Bus queue", label: "Jobs" },
        { op: "connect", from: "q", to: "Azure functions" },
      ],
      { request: "An Azure function consumes a Service Bus queue" },
    );
    expect(diagram.nodes).toHaveLength(2);
    expect(edges).toEqual(["Jobs -> Azure function"]);
    expect(diagram.nodes.find((n) => n.label === "Azure function")?.stencil).toBe("azure.functions");
  });
});

describe("round 3: the request's technologies win over unmentioned ones", () => {
  const stencils = (diagram: DiagramFile, ops: object[], request: string) =>
    Object.fromEntries(apply(diagram, ops, { request }).diagram.nodes.map((n) => [n.label, n.stencil]));

  it("create-14: the .NET service the request names, for a Go service it never mentions", () => {
    expect(
      stencils(
        EMPTY,
        [
          { op: "add", key: "svc", kind: "Go service", label: "dotnet-service" },
          { op: "add", key: "db", kind: "Azure SQL", label: "Azure SQL" },
          { op: "connect", from: "svc", to: "db" },
        ],
        "A .NET service writes Azure SQL",
      ),
    ).toEqual({ "dotnet-service": "service.dotnet", "Azure SQL": "azure.sql" });
  });

  it("create-28: a generic database and an unspecified component, for PostgreSQL and Lambda", () => {
    expect(
      stencils(
        EMPTY,
        [
          { op: "add", key: "c", kind: "Lambda", label: "Component" },
          { op: "add", key: "d", kind: "PostgreSQL", label: "Database" },
          { op: "connect", from: "c", to: "d" },
        ],
        "An unspecified component connects to a generic database",
      ),
    ).toEqual({ Component: "generic.service", Database: "generic.database" });
  });

  it("create-29: billing and shipping consumers, for queues labelled billing and shipping", () => {
    expect(
      stencils(
        EMPTY,
        [
          { op: "add", key: "t", kind: "Kafka topic", label: "Orders" },
          { op: "add", key: "b", kind: "Service Bus queue", label: "billing" },
          { op: "add", key: "s", kind: "Service Bus queue", label: "shipping" },
          { op: "connect", from: "t", to: "b" },
          { op: "connect", from: "t", to: "s" },
        ],
        "Publish an event to billing and shipping consumers inside an Azure boundary",
      ),
    ).toEqual({ Orders: "kafka.topic", billing: "generic.service", shipping: "generic.service" });
  });

  it("never changes a node whose technology the request names, an extra the request leaves open, or an existing node", () => {
    const named = [
      { op: "add", key: "g", kind: "Go service", label: "API" },
      { op: "add", key: "r", kind: "Redis cache", label: "Cache" },
      { op: "add", key: "x", kind: "Prometheus", label: "Metrics" },
      { op: "connect", from: "g", to: "r" },
      { op: "connect", from: "g", to: "x" },
    ];
    expect(stencils(EMPTY, named, "A Go service uses Redis cache")).toEqual({
      API: "service.go",
      Cache: "redis.cache",
      Metrics: "prometheus",
    });
    // "Workers" is a role, not Cloudflare Workers: the .NET worker stays.
    expect(
      stencils(
        EMPTY,
        [
          { op: "add", key: "w", kind: ".NET service", label: "billing-worker" },
          { op: "add", key: "p", kind: "PostgreSQL", label: "DB" },
          { op: "connect", from: "w", to: "p" },
        ],
        "Workers write to Postgres",
      ),
    ).toEqual({ "billing-worker": "service.dotnet", DB: "postgres" });
    // An existing node the request names isn't a component to give away.
    const { diagram } = apply(
      KAFKA,
      [
        { op: "add", key: "q", kind: "Service Bus queue", label: "inventory-dlq" },
        { op: "connect", from: "Inventory service", to: "q" },
      ],
      { request: "Add a dead-letter queue after Inventory service" },
    );
    expect(diagram.nodes.find((n) => n.label === "inventory-dlq")?.stencil).toBe("azure.service-bus.queue");
    expect(diagram.nodes.find((n) => n.id === "inventory")?.stencil).toBe("service.java");
  });
});

describe("round 3 review: reconciliation leaves updates alone and knows identities", () => {
  it("a kind change meant for an existing node isn't given to a new node", () => {
    const request = "Add a dead-letter queue after Payments service and make Orders database a MongoDB";
    for (const ops of [
      [
        { op: "add", key: "q", kind: "Service Bus queue", label: "payments-dlq" },
        { op: "connect", from: "Payments service", to: "q" },
        { op: "change_kind", target: "Orders database", kind: "MongoDB" },
      ],
      // Even when the reply forgets the kind change, "make … a MongoDB" is for the existing node.
      [
        { op: "add", key: "q", kind: "Service Bus queue", label: "payments-dlq" },
        { op: "connect", from: "Payments service", to: "q" },
      ],
    ]) {
      const { node } = apply(KAFKA, ops, { request });
      expect(node("payments-dlq")?.stencil).toBe("azure.service-bus.queue");
    }
  });

  it("two services of different technologies, swapped by the model, take the technology their labels name", () => {
    const { node } = apply(
      EMPTY,
      [
        { op: "add", key: "b", kind: "Java service", label: "billing" },
        { op: "add", key: "s", kind: "Go service", label: "shipping" },
        { op: "connect", from: "b", to: "s" },
      ],
      { request: "A billing Go service calls a shipping Java service" },
    );
    expect(node("billing")?.stencil).toBe("service.go");
    expect(node("shipping")?.stencil).toBe("service.java");
  });
});

describe("round 4: filled from the request, generic kinds, stray selections, pairing by label", () => {
  const node = (d: DiagramFile, id: string) => d.nodes.find((n) => n.id === id);

  it("edit-rename: a rename with no label takes the one the request gives", () => {
    const { diagram } = apply(KAFKA, [{ op: "rename", target: "Payments service" }], {
      request: "Rename Payments service to Billing service",
    });
    expect(node(diagram, "payments")?.label).toBe("Billing service");
  });

  it("edit-change: a kind change with no kind takes the request's, and the empty rename beside it goes", () => {
    const r = toOps(
      reply([
        { op: "change_kind", target: "Orders database" },
        { op: "rename", target: "Orders database" },
      ]),
      { diagram: KAFKA, request: "Make Orders database a MongoDB" },
    );
    expect(r).toMatchObject({ ok: true, ops: [{ op: "update", target: "order-db", kind: "MongoDB" }] });
    if (r.ok) expect(r.ops).toHaveLength(1);
  });

  it("the wrong one of the two ops, for exactly what the request asks, is the right one", () => {
    // A rename to the kind "make X a Y" asks for is that kind change (the typed schema makes a rename
    // carry a label).
    const kind = apply(KAFKA, [{ op: "rename", target: "Orders database", label: "MongoDB" }], {
      request: "Make Orders database a MongoDB",
    });
    expect(node(kind.diagram, "order-db")).toMatchObject({ label: "Orders database", stencil: "mongodb" });
    const rename = apply(KAFKA, [{ op: "change_kind", target: "Payments service", kind: "Billing service" }], {
      request: "Rename Payments service to Billing service",
    });
    expect(node(rename.diagram, "payments")).toMatchObject({ label: "Billing service", stencil: "service.go" });
  });

  it("fills only a missing field, only for the element the request names, and never invents one", () => {
    // A label the model wrote stays.
    const kept = apply(KAFKA, [{ op: "rename", target: "Payments service", label: "Billing" }], {
      request: "Rename Payments service to Billing service",
    });
    expect(node(kept.diagram, "payments")?.label).toBe("Billing");
    // Another element than the request's: still the retry's to fix.
    expect(
      error(KAFKA, [{ op: "rename", target: "Inventory service" }], {
        request: "Rename Payments service to Billing service",
      }),
    ).toMatch(/needs "target" and the new "label"/);
    // "change X to Y" with a Y that names no technology says nothing certain about a kind.
    expect(
      error(KAFKA, [{ op: "change_kind", target: "Orders database" }], {
        request: "Change Orders database to the old one",
      }),
    ).toMatch(/needs "target" and "kind"/);
    // A selected node is "this" on both sides.
    const sel = apply(KAFKA, [{ op: "change_kind", target: "this" }], {
      request: "Make this a MongoDB",
      scope: [{ id: "order-db", label: "Orders database", kind: "node" }],
    });
    expect(node(sel.diagram, "order-db")?.stencil).toBe("mongodb");
  });

  it("create-17: a generic kind loses to a label the request names that resolves confidently", () => {
    const r = apply(
      EMPTY,
      [
        { op: "add", key: "fd", kind: "Front Door", label: "Front Door" },
        { op: "add", key: "app", kind: "service", label: "App Service" },
        { op: "connect", from: "fd", to: "app" },
      ],
      { request: "Front Door routes to App Service" },
    );
    expect(r.node("App Service")?.stencil).toBe("azure.app-service");
  });

  it('create-23: "this" with nothing selected, in a request that never says it, is dropped', () => {
    const partner = { op: "add", key: "partner", kind: "external partner", label: "Partner" };
    const webhook = { op: "add", key: "webhook", kind: "webhook", label: "Webhook" };
    const request = "An external partner sends a webhook";
    const r = apply(
      EMPTY,
      [
        partner,
        webhook,
        { op: "connect", from: "partner", to: "webhook" },
        { op: "connect", from: "webhook", to: "this" },
      ],
      { request },
    );
    expect(r.edges).toEqual(["Partner -> Webhook"]);
    // Dropped, it leaves the webhook unconnected: the completeness check asks the retry for it.
    expect(error(EMPTY, [partner, webhook, { op: "connect", from: "webhook", to: "this" }], { request })).toMatch(
      /nothing connects/,
    );
    // A new node the reply keyed "this" is still that node.
    const keyed = apply(EMPTY, [{ ...partner, key: "this" }, webhook, { op: "connect", from: "this", to: "webhook" }], {
      request,
    });
    expect(keyed.edges).toEqual(["Partner -> Webhook"]);
  });

  it("create-24: a Lambda labelled email_service is the service, so the email goes to the unmentioned queue", () => {
    const r = apply(
      EMPTY,
      [
        { op: "add", key: "email_service", kind: "Lambda", label: "email_service" },
        { op: "add", key: "message_queue", kind: "SQS queue", label: "message_queue" },
        { op: "connect", from: "email_service", to: "message_queue" },
      ],
      { request: "A service delivers email" },
    );
    expect(r.node("email_service")?.stencil).toBe("aws.lambda");
    expect(r.node("message_queue")?.stencil).toBe("generic.email");
    expect(r.edges).toEqual(["email_service -> message_queue"]);
  });

  it("create-10: drawn against the verb, the connection is turned; drawn both ways, the reversed one goes", () => {
    const nodes = [
      { op: "add", key: "pubsub", kind: "PubSub", label: "pubsub" },
      { op: "add", key: "python", kind: "Python", label: "python" },
    ];
    const back = { op: "connect", from: "python", to: "pubsub" };
    const forth = { op: "connect", from: "pubsub", to: "python" };
    const request = "PubSub feeds Python";
    expect(apply(EMPTY, [...nodes, back], { request }).edges).toEqual(["pubsub -> python"]);
    expect(apply(EMPTY, [...nodes, back, forth], { request }).edges).toEqual(["pubsub -> python"]);
    // Both ways asked for: both stay.
    expect(
      apply(EMPTY, [...nodes, back, forth], {
        request: "PubSub feeds Python and Python publishes to PubSub",
      }).edges.sort(),
    ).toEqual(["pubsub -> python", "python -> pubsub"]);
  });
});

describe("round 4 review: negation, exact duplicates, requested responses, robust parsing", () => {
  const node = (d: DiagramFile, id: string) => d.nodes.find((n) => n.id === id);

  it("does not fill edits from negated clauses: the incomplete reply stays a validation failure", () => {
    for (const request of [
      "Do not rename Payments service to Billing service",
      "Don't rename Payments service to Billing; make Orders database a MongoDB",
    ])
      expect(error(KAFKA, [{ op: "rename", target: "Payments service" }], { request }), request).toMatch(
        /needs "target" and the new "label"/,
      );
    // Mixed: the positive edit is still filled; the forbidden one, left empty beside nothing, still fails.
    const r = toOps(
      reply([
        { op: "rename", target: "Orders database" },
        { op: "change_kind", target: "Orders database", kind: "MongoDB" },
      ]),
      { diagram: KAFKA, request: "Do not rename Orders database to Billing; make Orders database a MongoDB" },
    );
    // The empty rename beside a real change of the same node does nothing, so it goes; nothing is renamed.
    expect(r).toMatchObject({ ok: true, ops: [{ op: "update", target: "order-db", kind: "MongoDB" }] });
    if (r.ok) expect(r.ops).toHaveLength(1);
  });

  it("keeps a sublabel change and order-dependent changes", () => {
    const sub = apply(
      KAFKA,
      [
        { op: "change_kind", target: "Orders database", kind: "MongoDB" },
        { op: "change_kind", target: "Orders database", kind: "MongoDB", sublabel: "New" },
      ],
      { request: "Make Orders database a MongoDB" },
    );
    expect(node(sub.diagram, "order-db")).toMatchObject({ stencil: "mongodb", sublabel: "New" });
    const back = apply(KAFKA, [
      { op: "change_kind", target: "Orders database", kind: "MongoDB" },
      { op: "change_kind", target: "Orders database", kind: "Redis cache" },
      { op: "change_kind", target: "Orders database", kind: "MongoDB" },
    ]);
    expect(node(back.diagram, "order-db")?.stencil).toBe("mongodb");
  });

  it("keeps a response the request asks for in a clause it can't read", () => {
    const ops = [
      { op: "add", key: "c", kind: "browser", label: "Client" },
      { op: "add", key: "api", kind: "Node.js API", label: "API" },
      { op: "connect", from: "c", to: "api" },
      { op: "connect", from: "api", to: "c" },
    ];
    for (const request of [
      "Client calls API and API responds to Client",
      "A browser calls the API, and the API replies to the browser",
    ])
      expect(apply(EMPTY, ops, { request }).edges.sort(), request).toEqual(["API -> Client", "Client -> API"]);
  });

  it("a quoted label with delimiters is filled whole", () => {
    for (const label of ["Billing and shipping", "Billing, v2", "Billing. Shipping"]) {
      const { diagram } = apply(KAFKA, [{ op: "rename", target: "Payments service" }], {
        request: `Rename Payments service to "${label}"`,
      });
      expect(node(diagram, "payments")?.label).toBe(label);
    }
  });

  it("a field that isn't text is a validation error for the retry, not a crash", () => {
    for (const op of [
      { op: "rename", target: 42, label: "x" },
      { op: "rename", target: "Payments service", label: { a: 1 } },
      { op: "connect", from: ["a"], to: "b" },
      { op: 7 },
    ])
      expect(error(KAFKA, [op], { request: "Rename Payments service to Billing" })).toMatch(/must be text/);
    // null is a missing field, as before.
    expect(error(KAFKA, [{ op: "rename", target: "Payments service", label: null }], { request: "x" })).toMatch(
      /needs "target" and the new "label"/,
    );
  });

  it("a long adversarial request converts within budget", () => {
    const pad = " ".repeat(20_000);
    const add = [{ op: "add", key: "q", kind: "queue", label: "q" }];
    const t0 = performance.now();
    for (const request of [`rename ${pad}X`, `make ${pad}X`, `between ${pad}X`, `a${pad}should`])
      toOps(reply(add), { diagram: EMPTY, request });
    expect(performance.now() - t0).toBeLessThan(perfBudget(500));
  });
});

describe("round 5: names from the examples, after the retry", () => {
  const request = "An external partner sends a webhook";
  const partner = { op: "add", key: "partner", kind: "external partner", label: "Partner" };
  const hook = { op: "add", key: "hook", kind: "webhook", label: "Webhook" };

  it("are an error for the retry first; after it, they go with every op that uses them", () => {
    const ops = [
      partner,
      { op: "add", key: "sample-app", kind: "Go service", label: "sample-app" },
      hook,
      { op: "connect", from: "partner", to: "sample-app" },
      { op: "connect", from: "sample-app", to: "hook" },
      { op: "connect", from: "partner", to: "hook" },
    ];
    expect(error(EMPTY, ops, { request })).toMatch(/Don't reuse names from the examples \("sample-app"\)/);
    const r = toOps(reply(ops), { diagram: EMPTY, request, dropLeaked: true });
    expect(r).toMatchObject({ ok: true, dropped: ["sample-app"] });
    if (r.ok) expect(r.ops.map((o) => o.op)).toEqual(["add_node", "add_node", "connect"]);
  });

  it("drops a placeholder named only by a connection's label or an edit's key, and every one of several", () => {
    const r = toOps(
      reply([
        partner,
        hook,
        { op: "connect", from: "partner", to: "hook", label: "sample-batch" },
        { op: "connect", from: "partner", to: "sample.jobs" },
      ]),
      { diagram: EMPTY, request, dropLeaked: true },
    );
    // Both placeholders gone; nothing connects the two any more, so the completeness check says so.
    expect(r).toMatchObject({ ok: false, dropped: ["sample-batch", "sample.jobs"] });
    if (!r.ok) expect(r.error).toMatch(/nothing connects/);
  });

  it('keeps a "sample-" name the request or the diagram has', () => {
    const named = apply(
      EMPTY,
      [
        { op: "add", key: "app", kind: "Go service", label: "sample-app" },
        { op: "add", key: "db", kind: "PostgreSQL", label: "DB" },
        { op: "connect", from: "app", to: "db" },
      ],
      { request: "sample-app writes to a PostgreSQL DB" },
    );
    expect(named.edges).toEqual(["sample-app -> DB"]);
  });

  it('"sends" alone relates its subject to its object; "sends X to Y" still goes to Y', () => {
    expect(apply(EMPTY, [partner, hook, { op: "connect", from: "hook", to: "partner" }], { request }).edges).toEqual([
      "Partner -> Webhook",
    ]);
  });
});

describe("toOps: names shared across kinds", () => {
  // A node and a connection both named "Orders": a connection's ends and insert_between's are nodes, so the name
  // means the node there, as it does in the core's ops. Ops that take any element still find both.
  const shared: DiagramFile = {
    format: "diagrams/v1",
    title: "Shared names",
    nodes: [
      { id: "orders", stencil: "service.go", label: "Orders", x: 0, y: 0 },
      { id: "api", stencil: "service.go", label: "API", x: 300, y: 0 },
      { id: "db", stencil: "postgres", label: "Ledger", x: 600, y: 0 },
    ],
    edges: [
      { id: "e1", from: "api", to: "orders", label: "Orders", kind: "sync" },
      { id: "e2", from: "orders", to: "db", kind: "sync" },
    ],
  };

  it("connects and inserts by a name a connection also has", () => {
    const connected = apply(shared, [{ op: "connect", from: "Orders", to: "Ledger", flow: "message" }], {
      request: "Connect Orders to Ledger",
    });
    expect(connected.ops).toEqual([{ op: "connect", from: "orders", to: "db", kind: "async" }]);
    const inserted = apply(
      shared,
      [{ op: "insert_between", kind: "Redis cache", label: "Cache", from: "Orders", to: "Ledger" }],
      { request: "Put a Redis cache between Orders and Ledger" },
    );
    expect(inserted.edges).toEqual(expect.arrayContaining(["Orders -> Cache", "Cache -> Ledger"]));
  });

  it("still refuses the name where an op takes any element", () => {
    expect(error(shared, [{ op: "rename", target: "Orders", label: "Order service" }])).toMatch(/names 2 elements/);
  });
});
