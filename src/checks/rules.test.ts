import { describe, expect, it } from "vitest";
import type { DiagramEdge, DiagramFile, DiagramNode, Simulation } from "../model/types";
import { applyOps } from "../ai";
import { runChecks } from "./run";
import { stronglyConnected } from "./graph";
import { deadLetterFor } from "./rules/deadLetter";

// One rule at a time, on tiny diagrams: what fires, what doesn't, and the false positives the plan
// (docs/research/architecture-checks.md) names.

let x = 0;
const node = (id: string, stencil: string, props?: Record<string, unknown>, label = id): DiagramNode => ({
  id,
  stencil,
  label,
  x: (x += 300),
  y: 0,
  ...(props ? { props } : {}),
});
const msg = (from: string, to: string, props?: Record<string, unknown>): DiagramEdge => ({
  id: `${from}-${to}`,
  from,
  to,
  kind: "async",
  ...(props ? { props } : {}),
});
const req = (from: string, to: string): DiagramEdge => ({ id: `${from}-${to}`, from, to, kind: "sync" });
const diagram = (nodes: DiagramNode[], edges: DiagramEdge[], extra: Partial<DiagramFile> = {}): DiagramFile => ({
  format: "diagrams/v1",
  title: "t",
  nodes,
  edges,
  ...extra,
});
const ids = (d: DiagramFile, rule: string) =>
  runChecks(d)
    .findings.filter((f) => f.rule === rule)
    .map((f) => `${f.severity}:${f.target}`);

describe("dead-letter", () => {
  const queue = (consumerProps?: Record<string, unknown>, extra: DiagramEdge[] = [], more: DiagramNode[] = []) =>
    diagram(
      [
        node("api", "service.node"),
        node("q", "azure.service-bus.queue", undefined, "orders"),
        node("worker", "service.dotnet", consumerProps),
        ...more,
      ],
      [msg("api", "q"), msg("q", "worker"), ...extra],
    );

  it("suggests a dead-letter queue for a queue with consumers and none", () => {
    expect(ids(queue(), "dead-letter")).toEqual(["suggestion:q"]);
  });

  it("warns when a consumer can fail: a failure rate on the node or in a saved simulation", () => {
    expect(ids(queue({ failureRate: 0.1 }), "dead-letter")).toEqual(["warning:q"]);
    const sim = (s: Partial<Simulation>): Simulation => ({ id: "s", title: "Poison", traffic: [], ...s });
    const withSim = (s: Simulation) => ({ ...queue(), simulations: [s] });
    expect(ids(withSim(sim({ setup: { props: { worker: { failureRate: 1 } } } })), "dead-letter")).toEqual([
      "warning:q",
    ]);
    const timeline = sim({
      timeline: [{ atMs: 10, action: { do: "props", node: "worker", props: { failureRate: 1 } } }],
    });
    const finding = runChecks(withSim(timeline)).findings[0];
    expect(finding).toMatchObject({
      severity: "warning",
      title: "Failed messages are dropped",
      elements: ["q", "worker"],
    });
    expect(finding.message).toContain("“Poison”");
  });

  it("a consumer that goes down isn't evidence: the broker holds its messages (lag, not loss)", () => {
    const down: Simulation = {
      id: "s",
      title: "Outage",
      traffic: [],
      setup: { status: { worker: "down" } },
      timeline: [{ atMs: 10, action: { do: "status", node: "worker", status: "down" } }],
    };
    expect(ids({ ...queue(), simulations: [down] }, "dead-letter")).toEqual(["suggestion:q"]);
  });

  it("is quiet when the broker has a dead-letter route, marked or inferred from a name", () => {
    const dlq = node("dlq", "azure.service-bus.queue", undefined, "orders DLQ");
    expect(ids(queue({ failureRate: 1 }, [msg("q", "dlq", { dlq: true })], [dlq]), "dead-letter")).toEqual([]);
    expect(ids(queue({ failureRate: 1 }, [msg("q", "dlq")], [dlq]), "dead-letter")).toEqual([]);
  });

  it("a consumer's own dead-letter edge doesn't count: the broker's retries drop the messages", () => {
    const consumerSide = node("dlt", "kafka.topic", undefined, "worker errors");
    expect(
      ids(queue({ failureRate: 1 }, [msg("worker", "dlt", { dlq: true })], [consumerSide]), "dead-letter"),
    ).toEqual(["warning:q"]);
  });

  it("a dead-letter route whose filter misses the failing types is no route; one that takes them is", () => {
    const dlq = node("dlq", "azure.service-bus.queue", undefined, "orders DLQ");
    const typed = (filter: string[]) =>
      queue(
        { failureRate: 1 },
        [msg("q", "dlq", { dlq: true, filter }), msg("shop", "api")],
        [dlq, node("shop", "client.browser", { messageType: "OrderPlaced" })],
      );
    const none = runChecks(typed([])).findings.find((f) => f.rule === "dead-letter")!;
    expect(none).toMatchObject({ severity: "warning", elements: ["q", "worker", "q-dlq"] });
    expect(none.message).toContain("orders's dead-letter route doesn't take “OrderPlaced”");
    expect(none.fix).toEqual({
      label: "Send every failed message to orders DLQ",
      ops: [{ op: "update", target: "q-dlq", props: { filter: null } }],
    });
    expect(ids(typed(["Other*"]), "dead-letter")).toEqual(["warning:q"]);
    expect(ids(typed(["Order*"]), "dead-letter")).toEqual([]);
    // With no known traffic, a filter that takes nothing still takes nothing.
    const unknown = queue({ failureRate: 1 }, [msg("q", "dlq", { dlq: true, filter: [] })], [dlq]);
    expect(runChecks(unknown).findings[0].message).toContain("doesn't take any message");
    // Only the first dead-letter route is used: a second one catches nothing.
    const second = node("dlq2", "azure.service-bus.queue", undefined, "orders DLQ 2");
    const d = queue(
      { failureRate: 1 },
      [msg("q", "dlq", { dlq: true, filter: [] }), msg("q", "dlq2", { dlq: true })],
      [dlq, second],
    );
    expect(ids(d, "dead-letter")).toEqual(["warning:q"]);
  });

  it("topics and streams without failure evidence don't fire: projections replay from the log", () => {
    const d = diagram(
      [node("api", "service.node"), node("t", "kafka.topic"), node("proj", "generic.projection")],
      [msg("api", "t"), msg("t", "proj")],
    );
    expect(ids(d, "dead-letter")).toEqual([]);
    d.nodes[2].props = { failureRate: 0.05 };
    expect(ids(d, "dead-letter")).toEqual(["warning:t"]);
  });

  it("only counts processors as consumers, and never fires on a dead-letter queue itself", () => {
    const toStore = diagram(
      [node("api", "service.node"), node("q", "aws.sqs"), node("db", "postgres")],
      [msg("api", "q"), msg("q", "db")],
    );
    expect(ids(toStore, "dead-letter")).toEqual([]);
    const redrive = diagram(
      [
        node("api", "service.node"),
        node("q", "aws.sqs"),
        node("dlq", "aws.sqs", { isDeadLetter: true }, "parked"),
        node("replay", "service.node", { failureRate: 1 }),
      ],
      [msg("api", "q"), msg("q", "dlq", { dlq: true }), msg("dlq", "replay")],
    );
    expect(ids(redrive, "dead-letter")).toEqual([]);
  });

  it("names the dead-letter queue the way each family does", () => {
    const of = (stencil: string, label = "orders") => deadLetterFor({ id: "b", stencil, label, x: 0, y: 0 });
    expect(of("azure.service-bus.topic")).toEqual({
      kind: "azure.service-bus.queue",
      label: "orders DLQ",
      sublabel: "$DeadLetterQueue",
    });
    expect(of("aws.sqs")).toMatchObject({ kind: "aws.sqs", label: "orders-dlq" });
    expect(of("aws.sns")).toMatchObject({ kind: "aws.sqs", label: "orders-dlq" });
    expect(of("kafka.topic", "orders.created.v1")).toMatchObject({
      kind: "kafka.topic",
      label: "orders.created.v1.dlq",
    });
    expect(of("rabbitmq.exchange")).toMatchObject({ kind: "rabbitmq.queue", label: "orders.dlq" });
    expect(of("azure.event-hubs")).toMatchObject({ kind: "generic.queue", label: "orders DLQ" });
  });

  it.each([
    "azure.service-bus.queue",
    "aws.sqs",
    "kafka.topic",
    "rabbitmq.queue",
    "gcp.pubsub",
    "pulsar.topic",
    "azure.event-hubs",
  ])("the fix for a %s with a 200-character name is a valid edit", (stencil) => {
    const d = diagram(
      [
        node("api", "service.node"),
        node("q", stencil, { maxDeliveryCount: 2 }, "n".repeat(200)),
        node("w", "service.go", { failureRate: 1 }),
      ],
      [msg("api", "q"), msg("q", "w")],
    );
    const finding = runChecks(d).findings.find((f) => f.id === "dead-letter:q")!;
    const add = finding.fix!.ops![0] as { label: string };
    expect(add.label.length).toBeLessThanOrEqual(200);
    expect(add.label).toMatch(/n(-dlq|\.dlq| DLQ|-DLQ)$/);
    const applied = applyOps(d, finding.fix!.ops!);
    expect(applied.errors).toEqual([]);
    expect(runChecks(applied.diagram).findings.map((f) => f.id)).not.toContain("dead-letter:q");
  });
});

describe("no-reader", () => {
  it("warns when a topic gets messages and nothing reads it", () => {
    const d = diagram([node("api", "service.node"), node("t", "kafka.topic", undefined, "refunds")], [msg("api", "t")]);
    const [finding] = runChecks(d).findings;
    expect(finding).toMatchObject({
      id: "no-reader:t",
      severity: "warning",
      title: "Nobody reads refunds",
      elements: ["t", "api"],
      fix: { label: "Add a consumer…" },
    });
    expect(finding.fix?.ops).toBeUndefined();
    expect(finding.fix?.choice).toMatch(/Pick what reads refunds/);
  });

  it("a dead-letter queue nobody reads is a suggestion", () => {
    const d = diagram(
      [node("api", "service.node"), node("q", "aws.sqs"), node("w", "aws.lambda"), node("dlq", "aws.sqs", {}, "q-dlq")],
      [msg("api", "q"), msg("q", "w"), msg("q", "dlq")],
    );
    expect(ids(d, "no-reader")).toEqual(["suggestion:dlq"]);
    expect(runChecks(d).findings.find((f) => f.rule === "no-reader")?.title).toBe("Dead letters pile up in q-dlq");
  });

  it("is quiet for a broker with a reader, with no producers, or read by a request", () => {
    const read = diagram(
      [node("api", "service.node"), node("t", "kafka.topic"), node("db", "snowflake")],
      [msg("api", "t"), msg("t", "db")],
    );
    expect(ids(read, "no-reader")).toEqual([]);
    expect(ids(diagram([node("t", "kafka.topic")], []), "no-reader")).toEqual([]);
    const polled = diagram(
      [node("api", "service.node"), node("q", "aws.sqs"), node("w", "service.go")],
      [msg("api", "q"), req("q", "w")],
    );
    expect(ids(polled, "no-reader")).toEqual([]);
  });

  it("dependencies don't count as readers or producers", () => {
    const d = diagram(
      [node("api", "service.node"), node("t", "kafka.topic"), node("mon", "grafana")],
      [
        { ...msg("api", "t"), relation: "depends" },
        { ...msg("t", "mon"), relation: "telemetry" },
      ],
    );
    expect(ids(d, "no-reader")).toEqual([]);
  });
});

describe("sync-cycle", () => {
  it("finds one loop of requests, lists it, and makes the request into its first node a message", () => {
    const d = diagram(
      [
        node("orders", "service.dotnet", undefined, "Order service"),
        node("pricing", "service.go", undefined, "Pricing"),
      ],
      [req("orders", "pricing"), req("pricing", "orders")],
    );
    const [finding] = runChecks(d).findings;
    expect(finding).toMatchObject({
      id: "sync-cycle:orders",
      severity: "warning",
      title: "Requests go round in a circle",
    });
    expect(finding.message).toMatch(/^Order service → Pricing → Order service: /);
    expect(finding.elements).toEqual(["orders", "pricing", "orders-pricing", "pricing-orders"]);
    expect(finding.fix).toEqual({
      label: "Make Pricing → Order service a message",
      ops: [{ op: "update", target: "pricing-orders", kind: "async" }],
    });
  });

  it("one finding per loop, a self-loop included; messages and dependencies don't make a loop", () => {
    const d = diagram(
      [
        node("a", "generic.service"),
        node("b", "generic.service"),
        node("c", "generic.service"),
        node("d", "generic.service"),
        node("self", "generic.service"),
      ],
      [
        req("a", "b"),
        req("b", "c"),
        req("c", "a"),
        req("c", "d"),
        msg("d", "c"),
        { ...req("d", "a"), relation: "depends" },
        req("self", "self"),
      ],
    );
    expect(ids(d, "sync-cycle")).toEqual(["warning:a", "warning:self"]);
    expect(runChecks(d).findings.find((f) => f.target === "self")?.message).toMatch(/^self → self: /);
  });

  it("a request and a message back (a webhook callback drawn as a message) is no loop", () => {
    const d = diagram([node("a", "generic.service"), node("b", "generic.service")], [req("a", "b"), msg("b", "a")]);
    expect(ids(d, "sync-cycle")).toEqual([]);
  });

  it("finds strongly connected components in linear time without recursion", () => {
    const n = 20_000;
    const list = Array.from({ length: n }, (_, i) => `n${i}`);
    const components = stronglyConnected(list, (id) => [`n${(Number(id.slice(1)) + 1) % n}`]);
    expect(components).toHaveLength(1);
    expect(components[0]).toHaveLength(n);
  });
});

describe("capacity", () => {
  const pipeline = (workerProps: Record<string, unknown>, topicProps: Record<string, unknown> = {}) =>
    diagram(
      [
        node("src", "client.browser", { ratePerSec: 100 }),
        node("t", "kafka.topic", topicProps, "orders"),
        node("w", "service.java", workerProps, "Billing"),
        node("db", "postgres", { latencyMs: 500 }),
      ],
      [msg("src", "t"), msg("t", "w"), req("w", "db")],
    );

  it("warns about the busiest service over 100% at the diagram's own rates, with a fix that clears it", () => {
    const [finding] = runChecks(pipeline({ latencyMs: 100, concurrency: 1, replicas: 2 }, { partitions: 64 })).findings;
    expect(finding).toMatchObject({ id: "capacity:w", severity: "warning", title: "Billing can't keep up" });
    expect(finding.message).toContain("it gets 100/s and handles 20/s (500%)");
    expect(finding.fix).toEqual({
      label: "Set replicas to 19",
      ops: [{ op: "update", target: "w", props: { replicas: 19 } }],
    });
  });

  it("adds partitions when the replicas would sit idle", () => {
    const [finding] = runChecks(pipeline({ latencyMs: 100, concurrency: 1, replicas: 4 }, { partitions: 2 })).findings;
    expect(finding.message).toContain("2 of its 4 replicas sit idle");
    expect(finding.fix?.ops).toEqual([
      { op: "update", target: "w", props: { replicas: 19 } },
      { op: "update", target: "t", props: { partitions: 19 } },
    ]);
    expect(finding.fix?.label).toBe("Set replicas to 19 and orders partitions to 19");
  });

  it("is quiet under 100%, and ignores gateways and stores (single-lane estimates)", () => {
    // The store takes 2/s as a single lane at 500 ms, but planning (as live view's) leaves it unlimited.
    expect(ids(pipeline({ latencyMs: 10, concurrency: 8 }), "capacity")).toEqual([]);
  });

  it("says when sources use the default rate", () => {
    const d = diagram(
      [node("src", "client.browser"), node("w", "service.java", { latencyMs: 1000, concurrency: 1 })],
      [req("src", "w")],
    );
    expect(runChecks(d).findings[0].message).toMatch(/^At the diagram's own rates \(2\/s per source\), /);
  });

  it("uses free-play rates only: a saved simulation's overload isn't a finding", () => {
    const d = pipeline({ latencyMs: 10, concurrency: 8 });
    d.simulations = [
      {
        id: "storm",
        title: "Storm",
        traffic: [{ id: "x", node: "src", shape: { kind: "constant", ratePerSec: 10_000, durationMs: 1000 } }],
      },
    ];
    expect(ids(d, "capacity")).toEqual([]);
  });

  it("leaves a broker nobody reads to no-reader", () => {
    const d = diagram([node("src", "client.browser"), node("t", "kafka.topic")], [msg("src", "t")]);
    expect(runChecks(d).findings.map((f) => f.rule)).toEqual(["no-reader"]);
  });
});

describe("runChecks", () => {
  const busy = () =>
    diagram(
      [
        node("api", "service.node"),
        node("q", "aws.sqs"),
        node("w", "aws.lambda", { failureRate: 0.5 }),
        node("t", "kafka.topic"),
        node("q2", "aws.sqs"),
        node("w2", "aws.lambda"),
      ],
      [msg("api", "q"), msg("q", "w"), msg("api", "t"), msg("api", "q2"), msg("q2", "w2")],
    );

  it("lists warnings first, then suggestions, by rule and reading order; ids are rule:target", () => {
    expect(runChecks(busy()).findings.map((f) => `${f.severity}:${f.id}`)).toEqual([
      "warning:dead-letter:q",
      "warning:no-reader:t",
      "suggestion:dead-letter:q2",
    ]);
  });

  it("honours the file: rules turned off don't run, ignored findings are set apart", () => {
    const d = {
      ...busy(),
      checks: { off: ["no-reader", "future-rule"], ignore: [{ rule: "dead-letter", target: "q2" }] },
    };
    const result = runChecks(d);
    expect(result.findings.map((f) => f.id)).toEqual(["dead-letter:q"]);
    expect(result.ignored.map((f) => f.id)).toEqual(["dead-letter:q2"]);
    expect(result.off).toEqual(["no-reader"]);
    expect(result.ran).toEqual([
      "dead-letter",
      "sync-cycle",
      "message-loop",
      "sync-chain",
      "shared-database",
      "entry-gateway",
      "capacity",
      "blocked-threads",
      "scaling-blind",
      "call-timeout",
      "retry-backoff",
      "retry-budget",
      "retry-idempotency",
      "retry-layers",
      "call-breaker",
      "queue-limit",
      "retry-storm",
      "single-point",
      "secret-identity",
      "schema-registry",
    ]);
  });

  it("runs only the rules asked for", () => {
    expect(runChecks(busy(), { rules: ["no-reader"] }).findings.map((f) => f.id)).toEqual(["no-reader:t"]);
  });

  it("is deterministic and doesn't change the diagram", () => {
    const d = busy();
    const before = structuredClone(d);
    expect(runChecks(d)).toEqual(runChecks(structuredClone(d)));
    expect(d).toEqual(before);
  });
});
