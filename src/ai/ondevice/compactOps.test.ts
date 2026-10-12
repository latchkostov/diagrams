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
    ).toBe("Use at most 8 ops.");
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
    const ops = Array.from({ length: 8 }, (_, i) => ({
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
    expect(r).toEqual({
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
          { op: "add", key: "g", kind: "API gateway", label: "sample-gateway" },
          { op: "connect", from: "p", to: "g" },
        ],
        { request: "An external partner sends a webhook" },
      ),
    ).toMatch(/^Don't reuse names from the examples \("sample-gateway"\)/);
    expect(
      error(EMPTY, [{ op: "add", key: "g", kind: "API gateway", label: "sample-gateway" }], {
        request: "Add sample-gateway",
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
