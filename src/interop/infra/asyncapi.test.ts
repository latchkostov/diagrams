import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { DiagramFile } from "../../model/types";
import { relationOf } from "../../model/relations";
import { estimateCardSize } from "../../canvas/nodes/size";
import { detectFormat, importFiles, importText, type ImportOutcome } from "../formats";
import type { ImportReport } from "./graph";
import { importAsyncApi } from "./pipeline";
import { createSimulationRun } from "../../sim/simulation";
import { perfBudget } from "../../test/perfBudget";
import { Refs } from "./asyncapiRefs";

// AsyncAPI 2.x and 3.x import against the self-written fixtures (tests/fixtures/imports/asyncapi and hostile),
// as docs/research/imports.md § Mapping: AsyncAPI describes them.

const read = (path: string) => ({
  name: path.replace(/^.*\//, ""),
  text: readFileSync(`tests/fixtures/imports/${path}`, "utf8"),
});
const ORDERS = read("asyncapi/orders-service.asyncapi.yaml");
const SHIPPING = read("asyncapi/shipping-service.asyncapi.yaml");
const NOTIFICATIONS = read("asyncapi/notifications-2.6.asyncapi.yaml");

function ok(outcome: ImportOutcome): { diagram: DiagramFile; report: ImportReport } {
  if (outcome.ok !== true) throw new Error(`import failed: ${JSON.stringify(outcome)}`);
  if (!outcome.report) throw new Error("no report");
  return { diagram: outcome.diagram, report: outcome.report };
}
const edge = (d: DiagramFile, from: string, to: string) => d.edges.find((e) => e.from === from && e.to === to);
const node = (d: DiagramFile, id: string) => d.nodes.find((n) => n.id === id);
const groupOf = (d: DiagramFile, id: string) => d.groups?.find((g) => g.id === node(d, id)?.group)?.label;

describe("AsyncAPI import: the three fixtures together", () => {
  const all = () => ok(importAsyncApi([ORDERS, SHIPPING, NOTIFICATIONS]));

  it("is recognised, and several files import as one joined diagram", async () => {
    for (const f of [ORDERS, SHIPPING, NOTIFICATIONS]) expect(detectFormat(f.text, f.name)).toBe("asyncapi");
    const outcome = await importFiles([ORDERS, SHIPPING, NOTIFICATIONS]);
    expect(outcome.ok).toBe(true);
    if (outcome.ok === true) expect(outcome.format).toBe("asyncapi");
  });

  it("draws three apps, eight channels in two boundaries, and the Schema Registry", () => {
    const { diagram: d, report } = all();
    expect(d.title).toBe("3 services");
    const apps = ["order-service", "shipping-service", "notification-service"];
    for (const id of apps) expect(node(d, id)?.stencil).toBe("generic.service");
    const kafka = d.nodes.filter((n) => n.stencil === "kafka.topic").map((n) => n.label);
    expect(kafka.sort()).toEqual(
      [
        "orders.placed.v1",
        "orders.cancelled.v1",
        "payments.completed.v1",
        "payments.failed.v1",
        "shipping.dispatched.v1",
        "shipping.orders-placed.dlq",
      ].sort(),
    );
    // order-notifications is an exchange binding in one file and a queue in the other: the queue wins.
    expect(node(d, "topic-order-notifications")?.stencil).toBe("rabbitmq.queue");
    expect(node(d, "topic-email.sent")?.stencil).toBe("rabbitmq.exchange");
    expect(d.groups?.map((g) => g.label)).toEqual([
      "Kafka · kafka-0.shop.internal:9092",
      "RabbitMQ · rabbitmq.shop.internal:5672",
    ]);
    expect(groupOf(d, "topic-orders.placed.v1")).toBe("Kafka · kafka-0.shop.internal:9092");
    expect(groupOf(d, "topic-email.sent")).toBe("RabbitMQ · rabbitmq.shop.internal:5672");
    expect(groupOf(d, "order-service")).toBeUndefined();
    expect(node(d, "schema-registry.shop.internal")?.stencil).toBe("kafka.schema-registry");
    expect(d.nodes).toHaveLength(12);
    expect(report.notes).toContain(
      "order-notifications is a queue; Order service sends to it through the exchange “notifications”",
    );
  });

  it("joins producers and consumers on the channel, with typed messages, groups and the DLQ", () => {
    const { diagram: d } = all();
    // Order service → orders.placed.v1 → Shipping service, across two files.
    expect(edge(d, "order-service", "topic-orders.placed.v1")?.props).toEqual({ emits: "OrderPlaced" });
    expect(edge(d, "topic-orders.placed.v1", "shipping-service")?.props).toEqual({
      filter: ["OrderPlaced"],
      group: "shipping-service",
    });
    // Order service → order-notifications → Notification service (3.0 and 2.6).
    expect(edge(d, "order-service", "topic-order-notifications")?.props).toEqual({
      emits: "OrderConfirmationRequested",
    });
    expect(edge(d, "topic-order-notifications", "notification-service")?.props).toEqual({
      filter: ["OrderConfirmationRequested"],
    });
    expect(edge(d, "topic-payments.completed.v1", "order-service")?.props).toEqual({
      filter: ["PaymentCompleted"],
      group: "order-service",
    });
    // Shipping's dead letters: the route Live uses goes from the broker it reads, not from the app.
    expect(edge(d, "topic-orders.placed.v1", "topic-shipping.orders-placed.dlq")?.props).toEqual({ dlq: true });
    expect(edge(d, "shipping-service", "topic-shipping.orders-placed.dlq")).toBeUndefined();
    // Avro: the channel says so; both Kafka apps depend on the registry.
    expect(node(d, "topic-orders.placed.v1")?.props).toEqual({
      partitions: 12,
      contentType: "application/vnd.apache.avro",
    });
    for (const app of ["order-service", "shipping-service"])
      expect(relationOf(edge(d, app, "schema-registry.shop.internal"))).toBe("depends");
    expect(edge(d, "notification-service", "schema-registry.shop.internal")).toBeUndefined();
    expect(d.edges.filter((e) => relationOf(e) === "flow")).toHaveLength(10);
  });

  it("adds the Imported traffic simulation where messages start, and says so in the report", () => {
    const { diagram: d, report } = all();
    expect(d.simulations).toEqual([
      {
        id: "imported-traffic",
        title: "Imported traffic",
        description: "2 minutes of steady traffic where messages start, from the import.",
        traffic: [
          {
            id: "t1",
            node: "order-service",
            messageType: "OrderPlaced",
            shape: { kind: "constant", ratePerSec: 1, durationMs: 120_000 },
          },
        ],
      },
    ]);
    expect(report.traffic).toEqual([
      { nodeId: "order-service", label: "Order service", messageType: "OrderPlaced", ratePerSec: 1, seconds: 120 },
    ]);
    expect(report.notes).toContain("Go live and pick “Imported traffic” to watch messages flow");
  });

  it("lists what isn't drawn: schemas and security schemes, channels and messages nothing uses", () => {
    const { report } = all();
    expect(report.notDrawn).toEqual([
      { name: "Order service: 1 security scheme", reason: "not components of the system" },
      { name: "Order service: 1 payload schema", reason: "not components of the system" },
    ]);
    expect(report.notes).toContain("payments.completed.v1 has no producer in these files");
    const { report: unused } = ok(
      importAsyncApi([
        {
          name: "x.yaml",
          text: `asyncapi: 3.0.0
info: { title: X, version: "1" }
channels:
  used: { address: a, messages: { M: { name: M } } }
  idle: { address: b }
operations:
  s: { action: send, channel: { $ref: "#/channels/used" } }
components:
  messages:
    Orphan: { name: Orphan }
`,
        },
      ]),
    );
    expect(unused.notDrawn).toEqual([
      { name: "idle", reason: "no operation in X uses it" },
      { name: "Orphan", reason: "a message no channel uses" },
    ]);
  });

  it("lays out without overlaps, channels inside their server's boundary", () => {
    const { diagram: d } = all();
    const boxes = d.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, ...estimateCardSize(n.label, n.sublabel) }));
    const hit = (a: (typeof boxes)[0], b: { x: number; y: number; width: number; height: number }) =>
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++)
        expect(hit(boxes[i], boxes[j]), `${boxes[i].id} / ${boxes[j].id}`).toBe(false);
    for (const g of d.groups ?? [])
      for (const b of boxes) {
        const member = node(d, b.id)?.group === g.id;
        const inside = b.x >= g.x && b.y >= g.y && b.x + b.width <= g.x + g.width && b.y + b.height <= g.y + g.height;
        if (member) expect(inside, `${b.id} in ${g.label}`).toBe(true);
        else expect(hit(b, g), `${b.id} outside ${g.label}`).toBe(false);
      }
  });
});

describe("AsyncAPI import: 2.x, 3.x details and joining", () => {
  it("reads 2.6's inverted verbs: publish means it receives, subscribe means it sends", () => {
    const { diagram: d, report } = ok(importAsyncApi([NOTIFICATIONS]));
    expect(d.title).toBe("Notification service");
    expect(edge(d, "topic-order-notifications", "notification-service")).toBeDefined();
    expect(edge(d, "notification-service", "topic-order-notifications")).toBeUndefined();
    expect(edge(d, "notification-service", "topic-email.sent")?.props).toEqual({ emits: "EmailSent" });
    expect(edge(d, "topic-email.sent", "notification-service")).toBeUndefined();
    // Alone, nothing feeds order-notifications: the traffic starts at the app.
    expect(report.traffic?.map((t) => [t.nodeId, t.messageType])).toEqual([["notification-service", "EmailSent"]]);
    expect(report.notes).toContain("order-notifications has no producer in these files");
  });

  it("imported alone, a consumed topic has no producer, and that's a report line", () => {
    const { diagram: d, report } = ok(importAsyncApi([SHIPPING]));
    expect(edge(d, "topic-orders.placed.v1", "shipping-service")).toBeDefined();
    expect(report.notes).toContain("orders.placed.v1 has no producer in these files");
    // Avro without a registry URL on the server still brings a Schema Registry, and says why.
    expect(d.nodes.some((n) => n.stencil === "kafka.schema-registry")).toBe(true);
    expect(report.notes.some((n) => n.startsWith("Schema Registry added"))).toBe(true);
  });

  it("keeps channels on different clusters apart, even with the same address", () => {
    const doc = (title: string, host: string, action: string) => ({
      name: `${title}.yaml`,
      text: `asyncapi: 3.0.0
info: { title: ${title}, version: "1" }
servers: { main: { host: "${host}", protocol: kafka } }
channels: { orders: { address: orders, messages: { O: { name: O } } } }
operations: { op: { action: ${action}, channel: { $ref: "#/channels/orders" } } }
`,
    });
    const { diagram: d } = ok(
      importAsyncApi([
        doc("A", "kafka-a:9092", "send"),
        doc("B", "kafka-b:9092", "receive"),
        doc("C", "kafka-a:9092", "receive"),
      ]),
    );
    const topics = d.nodes.filter((n) => n.label === "orders");
    expect(topics).toHaveLength(2);
    expect(d.groups).toHaveLength(2);
    const onA = topics.find((t) => d.edges.some((e) => e.from === "a" && e.to === t.id))!;
    expect(edge(d, onA.id, "c")).toBeDefined();
    expect(edge(d, onA.id, "b")).toBeUndefined();
  });

  it("maps protocols and bindings to stencils, and lists the ones with no stencil as guesses", () => {
    const channel = (protocol: string, host: string, bindings = "") => ({
      name: `${protocol}.yaml`,
      text: `asyncapi: 3.0.0
info: { title: ${protocol} app, version: "1" }
servers: { s: { host: "${host}", protocol: ${protocol} } }
channels: { c: { address: ${protocol}-events, messages: { M: { name: M } }${bindings} } }
operations: { op: { action: send, channel: { $ref: "#/channels/c" } } }
`,
    });
    const cases: [ReturnType<typeof channel>, string, boolean][] = [
      [channel("mqtt", "broker.local:1883"), "mqtt.broker", false],
      [channel("sns", "sns.eu-west-1.amazonaws.com"), "aws.sns", false],
      [channel("sqs", "sqs.eu-west-1.amazonaws.com"), "aws.sqs", false],
      [channel("googlepubsub", "pubsub.googleapis.com"), "gcp.pubsub", false],
      [channel("kafka", "pkc-1.eu-west-1.aws.confluent.cloud:9092"), "confluent.cloud", false],
      [channel("kafka", "b-1.shop.kafka.eu-west-1.amazonaws.com:9092"), "aws.msk", false],
      [
        channel("amqp", "shop.servicebus.windows.net", ", bindings: { amqp: { is: queue } }"),
        "azure.service-bus.queue",
        false,
      ],
      [channel("amqp", "shop.servicebus.windows.net"), "azure.service-bus.topic", false],
      [channel("solace", "solace.local"), "generic.topic", true],
      [channel("ws", "ws.example.com"), "generic.topic", true],
    ];
    for (const [file, stencil, guess] of cases) {
      const { diagram: d, report } = ok(importAsyncApi([file]));
      const ch = d.nodes.find((n) => n.label.endsWith("-events"))!;
      expect(ch.stencil, file.name).toBe(stencil);
      expect(
        report.guesses.some((g) => g.nodeId === ch.id),
        file.name,
      ).toBe(guess);
    }
    const { diagram: aws } = ok(importAsyncApi([channel("sqs", "sqs.eu-west-1.amazonaws.com")]));
    expect(aws.groups?.[0].tone).toBe("aws");
  });

  it("follows a reply back to the requester", () => {
    const { diagram: d } = ok(
      importAsyncApi([
        {
          name: "rpc.yaml",
          text: `asyncapi: 3.0.0
info: { title: Client, version: "1" }
channels:
  req: { address: quotes.request, messages: { Q: { name: QuoteRequested } } }
  res: { address: quotes.reply, messages: { A: { name: QuoteReady } } }
operations:
  ask:
    action: send
    channel: { $ref: "#/channels/req" }
    reply:
      channel: { $ref: "#/channels/res" }
`,
        },
      ]),
    );
    expect(edge(d, "client", "topic-quotes.request")).toBeDefined();
    expect(edge(d, "topic-quotes.reply", "client")?.props).toEqual({ filter: ["QuoteReady"] });
  });
});

describe("AsyncAPI import: hostile $refs", () => {
  it("never fetches a remote $ref, stops at a cycle, and says why nothing could be drawn", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const outcome = await importText(read("hostile/recursive-ref.asyncapi.yaml").text, "recursive-ref.asyncapi.yaml");
    expect(outcome).toEqual({
      ok: false,
      error:
        "Nothing in it could be drawn: $ref https://schemas.example.com/remote.yaml#/components/messages/Remote (a remote reference, never fetched: open that file too).",
    });
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });

  it("lists a remote $ref in a document that otherwise imports, and follows refs into files opened with it", () => {
    const { report } = ok(
      importAsyncApi([
        {
          name: "app.yaml",
          text: `asyncapi: 3.0.0
info: { title: App, version: "1" }
channels:
  c: { address: events, messages: { E: { $ref: "./shared.yaml#/components/messages/Event" } } }
  r: { address: remote, messages: { R: { $ref: "https://example.com/x.yaml#/M" } } }
operations: { op: { action: send, channel: { $ref: "#/channels/c" } } }
`,
        },
        {
          name: "shared.yaml",
          text: `asyncapi: 3.0.0
info: { title: Shared, version: "1" }
components: { messages: { Event: { name: SharedEvent } } }
`,
        },
      ]),
    );
    expect(report.unread).toEqual([
      { name: "$ref https://example.com/x.yaml#/M", reason: "a remote reference, never fetched: open that file too" },
    ]);
  });

  it("bounds long $ref chains", () => {
    const chain = Array.from({ length: 40 }, (_, i) => `    m${i}: { $ref: "#/components/messages/m${i + 1}" }`).join(
      "\n",
    );
    const { report } = ok(
      importAsyncApi([
        {
          name: "chain.yaml",
          text: `asyncapi: 3.0.0
info: { title: Chain, version: "1" }
channels: { c: { address: x, messages: { M: { $ref: "#/components/messages/m0" } } } }
operations: { op: { action: send, channel: { $ref: "#/channels/c" } } }
components:
  messages:
${chain}
    m40: { name: Deep }
`,
        },
      ]),
    );
    expect(report.unread.some((l) => l.reason === "more than 32 references in a row")).toBe(true);
  });

  it("no value from a message schema or a server's security reaches the diagram", () => {
    const { diagram, report } = ok(importAsyncApi([ORDERS, SHIPPING, NOTIFICATIONS]));
    const out = JSON.stringify([diagram, report]);
    for (const secret of ["saslScram", "scramSha512", "retention.ms", "604800000", "declined", "totalCents"])
      expect(out, secret).not.toContain(secret);
  });
});

describe("AsyncAPI import: review fixes", () => {
  const doc = (name: string, text: string) => ({ name, text });

  it("resolves refs inside an externally referenced channel against that file", () => {
    const { diagram: d, report } = ok(
      importAsyncApi([
        doc(
          "app.yaml",
          `asyncapi: 3.0.0
info: { title: App, version: "1" }
components: { messages: { Event: { name: WrongEvent } } }
operations:
  publish: { action: send, channel: { $ref: "./shared.yaml#/channels/shared" } }
`,
        ),
        doc(
          "shared.yaml",
          `asyncapi: 3.0.0
info: { title: Shared, version: "1" }
servers: { main: { host: "kafka-x:9092", protocol: kafka } }
channels:
  shared:
    address: shared.events
    servers: [{ $ref: "#/servers/main" }]
    messages: { Event: { $ref: "#/components/messages/Event" } }
components: { messages: { Event: { name: SharedEvent } } }
`,
        ),
      ]),
    );
    const channel = d.nodes.find((n) => n.label === "shared.events");
    expect(channel?.stencil).toBe("kafka.topic");
    expect(edge(d, "app", channel?.id ?? "")?.props).toEqual({ emits: "SharedEvent" });
    expect(report.traffic?.[0].messageType).toBe("SharedEvent");
    expect(report.unread).toEqual([]);
  });

  it("keeps a channel message's key when an operation selects it", () => {
    const { diagram: d } = ok(
      importAsyncApi([
        doc(
          "p.yaml",
          `asyncapi: 3.0.0
info: { title: P, version: "1" }
channels:
  orders:
    address: orders
    messages: { OrderPlaced: { payload: { type: object } }, Other: { payload: { type: string } } }
operations:
  send:
    action: send
    channel: { $ref: "#/channels/orders" }
    messages: [{ $ref: "#/channels/orders/messages/OrderPlaced" }]
  read:
    action: receive
    channel: { $ref: "#/channels/orders" }
    messages: [{ $ref: "#/channels/orders/messages/OrderPlaced" }]
`,
        ),
      ]),
    );
    expect(edge(d, "p", "topic-orders")?.props).toEqual({ emits: "OrderPlaced" });
    expect(edge(d, "topic-orders", "p")?.props).toEqual({ filter: ["OrderPlaced"] });
  });

  it("keeps parallel routes that differ by consumer group or message type", () => {
    const { diagram: d } = ok(
      importAsyncApi([
        doc(
          "g.yaml",
          `asyncapi: 3.0.0
info: { title: G, version: "1" }
servers: { k: { host: "k:9092", protocol: kafka } }
channels: { c: { address: c, messages: { A: { name: A }, B: { name: B } } } }
operations:
  r1: { action: receive, channel: { $ref: "#/channels/c" }, bindings: { kafka: { groupId: { const: one } } } }
  r2: { action: receive, channel: { $ref: "#/channels/c" }, bindings: { kafka: { groupId: { const: two } } } }
  s1: { action: send, channel: { $ref: "#/channels/c" }, messages: [{ $ref: "#/channels/c/messages/A" }] }
  s2: { action: send, channel: { $ref: "#/channels/c" }, messages: [{ $ref: "#/channels/c/messages/B" }] }
`,
        ),
      ]),
    );
    const groups = d.edges.filter((e) => e.from === "topic-c").map((e) => String(e.props?.group));
    expect(groups.sort()).toEqual(["one", "two"]);
    const emits = d.edges.filter((e) => e.to === "topic-c").map((e) => String(e.props?.emits));
    expect(emits.sort()).toEqual(["A", "B"]);
  });

  it("draws an app's dead-letter channel as an ordinary send when its input can't be told", () => {
    const { diagram: d, report } = ok(
      importAsyncApi([
        doc(
          "w.yaml",
          `asyncapi: 3.0.0
info: { title: W, version: "1" }
channels:
  a: { address: a, messages: { A: { name: A } } }
  b: { address: b, messages: { B: { name: B } } }
  dead: { address: w.dlq, messages: { X: { name: X } } }
operations:
  ra: { action: receive, channel: { $ref: "#/channels/a" } }
  rb: { action: receive, channel: { $ref: "#/channels/b" } }
  fail: { action: send, channel: { $ref: "#/channels/dead" } }
`,
        ),
      ]),
    );
    expect(edge(d, "w", "topic-w.dlq")?.props).toEqual({ emits: "X" });
    expect(d.edges.some((e) => e.props?.dlq)).toBe(false);
    expect(report.notes.some((n) => n.includes("couldn't be told"))).toBe(true);
  });

  it("delivers the imported traffic to Shipping and Notification in the simulation", () => {
    const { diagram: d } = ok(importAsyncApi([ORDERS, SHIPPING, NOTIFICATIONS]));
    const simulation = d.simulations?.[0];
    if (!simulation) throw new Error("no simulation");
    const run = createSimulationRun(d, simulation);
    for (let t = 0; t < 30_000; t += 50) run.step(50);
    const nodes = run.engine.snapshot().nodes;
    expect(nodes["shipping-service"].processed).toBeGreaterThan(0);
    expect(nodes["notification-service"].processed).toBeGreaterThan(0);
  });

  it("never throws on a malformed percent escape in a server reference", async () => {
    const bad = doc(
      "bad.yaml",
      `asyncapi: 3.0.0
info: { title: Bad, version: "1" }
servers: { main: { host: "k:9092", protocol: kafka } }
channels: { c: { address: c, servers: [{ $ref: "#/servers/%" }], messages: { M: { name: M } } } }
operations: { s: { action: send, channel: { $ref: "#/channels/c" } } }
`,
    );
    const outcome = await importFiles([bad, { ...bad, name: "bad-2.yaml" }]);
    expect(outcome.ok).toBe(true);
    if (outcome.ok === true)
      expect(outcome.report?.unread.some((l) => l.reason === "a malformed reference")).toBe(true);
  });
});

describe("AsyncAPI import: hostile sizes", () => {
  const header = `asyncapi: 3.0.0
info: { title: Big, version: "1" }
`;
  const doc = (name: string, text: string) => ({ name, text });

  it("reads a channel's messages once, however many operations select from it", () => {
    const messages = Array.from({ length: 10_000 }, (_, i) => `      m${i}: { name: M${i} }`).join("\n");
    const ops = Array.from(
      { length: 1_000 },
      (_, i) =>
        `  o${i}: { action: send, channel: { $ref: "#/channels/c" }, messages: [{ $ref: "#/channels/c/messages/m${i}" }] }`,
    ).join("\n");
    const text = `${header}channels:\n  c:\n    address: c\n    messages:\n${messages}\noperations:\n${ops}\n`;
    const started = performance.now();
    const { diagram: d } = ok(importAsyncApi([doc("big.yaml", text)]));
    expect(performance.now() - started).toBeLessThan(perfBudget(3_000));
    expect(d.edges.filter((e) => e.from === "big")).toHaveLength(1_000);
  });

  it("lists remote references once each in linear time, and the report caps them", () => {
    // The scan alone, on 60,000 distinct remote refs (parsing that much YAML is the library's time, not ours).
    const schemas: Record<string, unknown> = {};
    for (let i = 0; i < 60_000; i++) schemas[`s${i}`] = { $ref: `https://example.com/s${i}.json` };
    const refs = new Refs(new Map());
    const started = performance.now();
    refs.scan({ file: "x.yaml", root: { components: { schemas } }, v2: false });
    refs.scan({ file: "x.yaml", root: { components: { schemas } }, v2: false });
    expect(performance.now() - started).toBeLessThan(perfBudget(1_000));
    expect(refs.unread).toHaveLength(60_000);
    // End to end: the report lists 200 and counts the rest.
    const many = Array.from({ length: 1_500 }, (_, i) => `    s${i}: { $ref: "https://example.com/s${i}.json" }`).join(
      "\n",
    );
    const text = `${header}channels: { c: { address: c, messages: { M: { name: M } } } }
operations: { s: { action: send, channel: { $ref: "#/channels/c" } } }
components:
  schemas:
${many}
`;
    const { report } = ok(importAsyncApi([doc("refs.yaml", text)]));
    expect(report.unread).toHaveLength(201);
    expect(report.unread.at(-1)).toEqual({ name: "1,300 more", reason: "not listed" });
  });

  it("walks a huge enum without overflowing the stack", () => {
    const values = Array.from({ length: 140_000 }, (_, i) => i).join(",");
    const text = `${header}channels: { c: { address: c, messages: { M: { name: M, payload: { enum: [${values}] } } } } }
operations: { s: { action: send, channel: { $ref: "#/channels/c" } } }
`;
    expect(() => importAsyncApi([doc("enum.yaml", text)])).not.toThrow();
  });
});
