// Simulation scenarios: a small diagram, a scripted sequence of engine actions, and checks that
// encode docs/SIMULATION.md. Pure data so they run both in the Lab readout and in Vitest.

import { DIAGRAM_FORMAT, type DiagramFile, type DiagramNode, type DiagramEdge } from "../model/types";
import type { SimSnapshot } from "../sim/types";
import { colX, rowY } from "./generators";
import type { ControlDef, ControlValues, Scenario } from "./types";

export interface ScenarioDef {
  id: string;
  title: string;
  description: string;
  controls?: readonly ControlDef[];
  diagram: (v: ControlValues) => DiagramFile;
  scenario: (v: ControlValues) => Scenario;
}

const d = (title: string, description: string, nodes: DiagramNode[], edges: DiagramEdge[]): DiagramFile => ({
  format: DIAGRAM_FORMAT,
  title,
  description,
  nodes,
  edges,
});
const node = (
  id: string,
  stencil: string,
  label: string,
  col: number,
  row: number,
  extra: Partial<DiagramNode> = {},
): DiagramNode => ({
  id,
  stencil,
  label,
  x: colX(col),
  y: rowY(row),
  ...extra,
});
const edge = (from: string, to: string, extra: Partial<DiagramEdge> = {}): DiagramEdge => ({
  id: `${from}-${to}`,
  from,
  to,
  kind: "async",
  ...extra,
});

const n = (s: SimSnapshot, id: string) => s.nodes[id];
const processed = (s: SimSnapshot, id: string) => n(s, id)?.processed ?? 0;

// ---------- scenarios ----------

const fanOut: ScenarioDef = {
  id: "sim-fan-out",
  title: "Fan-out to 3 groups",
  description: "One topic, three consumer groups: every group receives every message.",
  controls: [{ type: "number", key: "count", label: "Messages", default: 20, min: 1, max: 500 }],
  diagram: () =>
    d(
      "Fan-out to 3 consumer groups",
      "Each subscriber is its own consumer group, so each gets a copy.",
      [
        node("orders", "service.node", "Orders API", 0, 1),
        node("topic", "kafka.topic", "orders", 1, 1, { sublabel: "orders.created" }),
        node("billing", "service.dotnet", "Billing", 2, 0, { sublabel: "group: billing" }),
        node("shipping", "service.java", "Shipping", 2, 1, { sublabel: "group: shipping" }),
        node("analytics", "service.python", "Analytics", 2, 2, { sublabel: "group: analytics" }),
      ],
      [edge("orders", "topic"), edge("topic", "billing"), edge("topic", "shipping"), edge("topic", "analytics")],
    ),
  scenario: (v) => {
    const count = Number(v.count);
    return {
      script: [{ at: 0, do: "inject", node: "topic", count, type: "OrderCreated", spreadMs: 2000 }],
      checks: [
        { at: 15000, label: `billing processed ${count}`, pass: (s) => processed(s, "billing") === count },
        { at: 15000, label: `shipping processed ${count}`, pass: (s) => processed(s, "shipping") === count },
        { at: 15000, label: `analytics processed ${count}`, pass: (s) => processed(s, "analytics") === count },
        { at: 15000, label: "nothing left in the system", pass: (s) => s.inSystem === 0 },
      ],
    };
  },
};

const competing: ScenarioDef = {
  id: "sim-competing-consumers",
  title: "Competing consumers",
  description:
    "A queue (or a shared Kafka consumer group) spreads messages across workers; each message is handled once.",
  controls: [
    {
      type: "select",
      key: "broker",
      label: "Broker",
      default: "queue",
      options: [
        { value: "queue", label: "Service Bus queue" },
        { value: "group", label: "Kafka topic, one group" },
      ],
    },
    { type: "number", key: "count", label: "Messages", default: 30, min: 1, max: 500 },
  ],
  diagram: (v) => {
    const kafka = v.broker === "group";
    const props = kafka ? { group: "workers" } : undefined;
    return d(
      "Competing consumers",
      kafka ? "Three consumers share the group 'workers'." : "Three workers pull from one queue.",
      [
        node("producer", "service.go", "Producer", 0, 1),
        node("broker", kafka ? "kafka.topic" : "azure.service-bus.queue", kafka ? "jobs" : "jobs queue", 1, 1, {
          sublabel: kafka ? "jobs.v1" : "jobs",
        }),
        node("w1", "azure.functions", "Worker 1", 2, 0),
        node("w2", "azure.functions", "Worker 2", 2, 1),
        node("w3", "azure.functions", "Worker 3", 2, 2),
      ],
      [
        edge("producer", "broker"),
        edge("broker", "w1", { props }),
        edge("broker", "w2", { props }),
        edge("broker", "w3", { props }),
      ],
    );
  },
  scenario: (v) => {
    const count = Number(v.count);
    const total = (s: SimSnapshot) => processed(s, "w1") + processed(s, "w2") + processed(s, "w3");
    return {
      script: [{ at: 0, do: "inject", node: "broker", count, type: "Job" }],
      checks: [
        { at: 20000, label: `workers handled ${count} in total (each once)`, pass: (s) => total(s) === count },
        {
          at: 20000,
          label: "every worker got some",
          pass: (s) => ["w1", "w2", "w3"].every((id) => processed(s, id) > 0),
        },
      ],
    };
  },
};

const slowLag: ScenarioDef = {
  id: "sim-slow-consumer",
  title: "Slow consumer lag",
  description:
    "Continuous traffic; one consumer group is slow, so its lag on the topic grows while the fast one keeps up.",
  controls: [
    { type: "number", key: "rate", label: "Rate (msg/s)", default: 6, min: 1, max: 100 },
    { type: "number", key: "slowms", label: "Slow latency (ms)", default: 1500, min: 50, max: 10000, step: 50 },
  ],
  diagram: (v) =>
    d(
      "Slow consumer lag",
      "Fast and slow consumer groups on one topic.",
      [
        node("devices", "client.iot", "Devices", 0, 1, {
          props: { ratePerSec: Number(v.rate), messageType: "Reading" },
        }),
        node("topic", "azure.event-hubs", "telemetry", 1, 1, { sublabel: "telemetry", props: { partitions: 8 } }),
        node("fast", "service.go", "Alerts", 2, 0, { sublabel: "fast", props: { latencyMs: 80, concurrency: 8 } }),
        node("slow", "service.python", "Reports", 2, 2, {
          sublabel: "slow",
          props: { latencyMs: Number(v.slowms), concurrency: 1 },
        }),
      ],
      [edge("devices", "topic"), edge("topic", "fast"), edge("topic", "slow")],
    ),
  scenario: () => ({
    script: [
      { at: 0, do: "traffic", on: true },
      { at: 12000, do: "traffic", on: false },
    ],
    checks: [
      { at: 10000, label: "slow group lag > 5", pass: (s) => (n(s, "topic")?.lag["topic-slow"] ?? 0) > 5 },
      { at: 10000, label: "fast group lag ≤ 3", pass: (s) => (n(s, "topic")?.lag["topic-fast"] ?? 0) <= 3 },
      { at: 10000, label: "fast processed more than slow", pass: (s) => processed(s, "fast") > processed(s, "slow") },
    ],
  }),
};

const dlq: ScenarioDef = {
  id: "sim-dlq",
  title: "Consumer down, retries, DLQ",
  description:
    "Poison messages fail 3 times and are dead-lettered. Then the consumer goes down: the queue backs up, and drains when it comes back.",
  controls: [
    { type: "number", key: "poison", label: "Poison messages", default: 4, min: 1, max: 50 },
    { type: "number", key: "good", label: "Good messages", default: 10, min: 1, max: 200 },
  ],
  diagram: () =>
    d(
      "Retries and dead-lettering",
      "maxDeliveryCount 3; the DLQ edge is inferred from the target's label.",
      [
        node("api", "service.dotnet", "Orders API", 0, 1),
        node("queue", "azure.service-bus.queue", "orders", 1, 1, {
          sublabel: "orders",
          props: { maxDeliveryCount: 3 },
        }),
        node("worker", "azure.functions", "Fulfilment", 2, 0, { props: { failureRate: 1, latencyMs: 200 } }),
        node("dlq", "azure.service-bus.queue", "Dead-letter queue", 2, 2, { sublabel: "orders/$deadletterqueue" }),
      ],
      [edge("api", "queue"), edge("queue", "worker"), edge("queue", "dlq", { props: { dlq: true } })],
    ),
  scenario: (v) => {
    const poison = Number(v.poison);
    const good = Number(v.good);
    return {
      script: [
        { at: 0, do: "inject", node: "queue", count: poison, type: "PoisonOrder" },
        { at: 10000, do: "props", node: "worker", props: { failureRate: 0 } },
        { at: 10000, do: "status", node: "worker", status: "down" },
        { at: 10500, do: "inject", node: "queue", count: good, type: "OrderPlaced" },
        { at: 16000, do: "status", node: "worker", status: "up" },
      ],
      checks: [
        {
          at: 9500,
          label: `${poison} dead-lettered after 3 attempts each`,
          pass: (s) => n(s, "queue")?.deadLettered === poison,
        },
        { at: 9500, label: `worker failed ${poison * 3} attempts`, pass: (s) => n(s, "worker")?.failed === poison * 3 },
        { at: 15500, label: "backlog builds while worker is down", pass: (s) => (n(s, "queue")?.backlog ?? 0) >= good },
        { at: 26000, label: `drains after recovery (${good} processed)`, pass: (s) => processed(s, "worker") === good },
      ],
    };
  },
};

const roundRobin: ScenarioDef = {
  id: "sim-gateway-round-robin",
  title: "Gateway round-robin",
  description: "A gateway spreads requests evenly across its backends over sync edges.",
  controls: [
    { type: "number", key: "backends", label: "Backends", default: 3, min: 2, max: 6 },
    { type: "number", key: "count", label: "Requests", default: 30, min: 1, max: 600 },
  ],
  diagram: (v) => {
    const k = Number(v.backends);
    const backends = Array.from({ length: k }, (_, i) => node(`b${i + 1}`, "aws.lambda", `Backend ${i + 1}`, 2, i));
    return d(
      "Gateway round-robin",
      `${k} backends behind one API gateway.`,
      [
        node("web", "client.browser", "Browser", 0, (k - 1) / 2),
        node("gw", "aws.api-gateway", "API Gateway", 1, (k - 1) / 2),
        ...backends,
      ],
      [edge("web", "gw", { kind: "sync" }), ...backends.map((b) => edge("gw", b.id, { kind: "sync" }))],
    );
  },
  scenario: (v) => {
    const k = Number(v.backends);
    const count = Number(v.count);
    const ids = Array.from({ length: k }, (_, i) => `b${i + 1}`);
    return {
      script: [{ at: 0, do: "inject", node: "gw", count, type: "GET /items", spreadMs: 3000 }],
      checks: [
        {
          at: 12000,
          label: `all ${count} requests handled`,
          pass: (s) => ids.reduce((a, id) => a + processed(s, id), 0) === count,
        },
        {
          at: 12000,
          label: "spread evenly (±1)",
          pass: (s) => {
            const p = ids.map((id) => processed(s, id));
            return Math.max(...p) - Math.min(...p) <= 1;
          },
        },
      ],
    };
  },
};

const storm: ScenarioDef = {
  id: "sim-traffic-storm",
  title: "Traffic storm",
  description: "Three busy sources overload a service for 8 seconds; backlog builds, then drains after traffic stops.",
  controls: [{ type: "number", key: "rate", label: "Rate per source (msg/s)", default: 15, min: 1, max: 200 }],
  diagram: (v) => {
    const rate = Number(v.rate);
    return d(
      "Traffic storm",
      "Bursty clients, a bottleneck service, and a fan-out topic.",
      [
        node("web", "client.browser", "Web", 0, 0, { props: { ratePerSec: rate, messageType: "WebOrder" } }),
        node("mobile", "client.mobile", "Mobile", 0, 1, { props: { ratePerSec: rate, messageType: "AppOrder" } }),
        node("partner", "generic.webhook", "Partner webhook", 0, 2, {
          props: { ratePerSec: rate, messageType: "PartnerOrder" },
        }),
        node("gw", "azure.front-door", "Front Door", 1, 1),
        node("orders", "service.dotnet", "Orders", 2, 1, { props: { latencyMs: 250, concurrency: 4 } }),
        node("topic", "azure.service-bus.topic", "order-events", 3, 1, {
          sublabel: "orders",
          props: { partitions: 12 },
        }),
        node("billing", "azure.functions", "Billing", 4, 0, { props: { concurrency: 12, latencyMs: 150 } }),
        node("search", "azure.container-apps", "Search indexer", 4, 2, { props: { concurrency: 12, latencyMs: 150 } }),
        node("db", "azure.cosmos-db", "Orders DB", 5, 1),
      ],
      [
        edge("web", "gw", { kind: "sync" }),
        edge("mobile", "gw", { kind: "sync" }),
        edge("partner", "gw", { kind: "sync" }),
        edge("gw", "orders", { kind: "sync" }),
        edge("orders", "topic"),
        edge("topic", "billing"),
        edge("topic", "search"),
        edge("billing", "db", { kind: "sync" }),
      ],
    );
  },
  scenario: (v) => {
    const rate = Number(v.rate);
    // Orders handles 4 / 0.25s = 16 msg/s; the storm sends 3 × rate.
    const overloaded = rate * 3 > 16;
    return {
      script: [
        { at: 0, do: "traffic", on: true },
        { at: 8000, do: "traffic", on: false },
      ],
      checks: [
        ...(overloaded
          ? [
              {
                at: 7500,
                label: "orders backlog builds (> 20)",
                pass: (s: SimSnapshot) => (n(s, "orders")?.backlog ?? 0) > 20,
              },
            ]
          : []),
        { at: 7500, label: "messages reach the database", pass: (s) => processed(s, "db") > 0 },
        { at: 60000, label: "system drains after the storm", pass: (s) => s.inSystem === 0 },
      ],
    };
  },
};

export const scenarioDefs: ScenarioDef[] = [fanOut, competing, slowLag, dlq, roundRobin, storm];

/** When a scenario is "finished": its explicit duration, or 2s past its last action / check. */
export function scenarioDuration(s: Scenario): number {
  if (s.duration) return s.duration;
  const last = Math.max(0, ...s.script.map((a) => a.at), ...s.checks.map((c) => c.at));
  return last + 2000;
}
