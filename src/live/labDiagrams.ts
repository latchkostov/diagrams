// Fixture diagrams and simulations for the live view's Lab presets (src/lab/presets.tsx).

import { DIAGRAM_FORMAT, type DiagramEdge, type DiagramFile, type DiagramNode, type Simulation } from "../model/types";

const at = (col: number, row: number) => ({ x: 40 + col * 360, y: 40 + row * 120 });

/**
 * Fan-out built to keep ~`target` particles in flight: sources → one topic → N consumers → N stores.
 * Each message is drawn on 1 + 2N edges for ~0.9 s each, so the source rate is derived from `target`.
 */
export function particleStressDiagram(target: number, consumers = 8): DiagramFile {
  const sources = 4;
  const perMessage = 0.9 * (1 + 2 * consumers);
  const rate = Math.max(1, Math.round(target / perMessage / sources));
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  const mid = (consumers - 1) / 2;
  for (let i = 0; i < sources; i++) {
    nodes.push({
      id: `src-${i}`,
      stencil: "client.browser",
      label: `Clients ${i + 1}`,
      sublabel: `${rate} msg/s`,
      ...at(0, mid - 1.5 + i),
      props: {
        ratePerSec: rate,
        messageType: ["OrderPlaced", "MemberJoined", "PaymentAuthorized", "TelemetryReading"][i],
      },
    });
    edges.push({ id: `e-src-${i}`, from: `src-${i}`, to: "topic" });
  }
  nodes.push({
    id: "topic",
    stencil: "kafka.topic",
    label: "events",
    sublabel: "all traffic",
    ...at(1, mid),
    props: { partitions: 100_000 },
  });
  for (let i = 0; i < consumers; i++) {
    nodes.push({
      id: `svc-${i}`,
      stencil: "service.go",
      label: `consumer ${i + 1}`,
      sublabel: `group: g${i + 1}`,
      ...at(2, i),
      props: { concurrency: 100_000, latencyMs: 60 },
    });
    nodes.push({ id: `db-${i}`, stencil: "postgres", label: `store ${i + 1}`, ...at(3, i) });
    edges.push({ id: `e-topic-${i}`, from: "topic", to: `svc-${i}`, props: { group: `g${i + 1}` } });
    edges.push({ id: `e-db-${i}`, from: `svc-${i}`, to: `db-${i}` });
  }
  return {
    format: DIAGRAM_FORMAT,
    title: `Particles stress: ~${target}`,
    description: `${sources} sources at ${rate} msg/s fanned out to ${consumers} consumer groups.`,
    nodes,
    edges,
  };
}

/** Every badge state at once: down, paused, backlog heat, failures with retries, dead letters, lag. */
export function badgeStatesDiagram(): DiagramFile {
  const sim: Simulation = {
    id: "badges",
    title: "Badge states",
    seed: 7,
    setup: {
      status: { "down-svc": "down", "paused-svc": "paused" },
      props: {
        "slow-svc": { latencyMs: 2500, concurrency: 1 },
        worker: { failureRate: 0.45 },
        "jobs-api": { failureRate: 0.2 },
      },
    },
    traffic: [
      {
        id: "orders",
        node: "api",
        messageType: "OrderPlaced",
        label: "Orders",
        shape: { kind: "constant", ratePerSec: 18, durationMs: 12_000 },
      },
      {
        id: "jobs",
        node: "jobs-api",
        messageType: "InvoiceRequested",
        label: "Jobs",
        shape: { kind: "constant", ratePerSec: 10, durationMs: 12_000 },
      },
    ],
    timeline: [],
    expectations: [
      {
        id: "nothing-dead",
        label: "Nothing dead-lettered",
        metric: { node: "jobs", field: "deadLettered" },
        op: "==",
        value: 0,
        when: "always",
      },
    ],
  };
  return {
    format: DIAGRAM_FORMAT,
    title: "Badge states",
    description: "Down, paused, slow, failing and healthy consumers side by side.",
    nodes: [
      { id: "api", stencil: "aws.api-gateway", label: "Orders API", ...at(0, 1) },
      { id: "orders", stencil: "kafka.topic", label: "orders", sublabel: "4 consumer groups", ...at(1, 1) },
      { id: "fast-svc", stencil: "service.go", label: "Healthy", sublabel: "group: fast", ...at(2, 0) },
      { id: "slow-svc", stencil: "service.java", label: "Slow", sublabel: "group: slow · 2.5 s", ...at(2, 1) },
      { id: "down-svc", stencil: "service.node", label: "Down", sublabel: "group: down", ...at(2, 2) },
      { id: "paused-svc", stencil: "service.python", label: "Paused", sublabel: "group: paused", ...at(2, 3) },
      { id: "fast-db", stencil: "postgres", label: "orders db", ...at(3, 0) },
      { id: "jobs-api", stencil: "azure.functions", label: "Jobs intake", ...at(0, 5) },
      { id: "jobs", stencil: "azure.service-bus.queue", label: "jobs", sublabel: "max 3 deliveries", ...at(1, 5) },
      { id: "worker", stencil: "azure.container-apps", label: "Flaky worker", sublabel: "45% failures", ...at(2, 5) },
      { id: "ledger", stencil: "azure.cosmos-db", label: "ledger", ...at(3, 5) },
      { id: "dlq", stencil: "azure.service-bus.queue", label: "jobs DLQ", sublabel: "dead letters", ...at(2, 6.2) },
    ],
    edges: [
      { id: "e1", from: "api", to: "orders", kind: "sync" },
      { id: "e2", from: "orders", to: "fast-svc", props: { group: "fast" } },
      { id: "e3", from: "orders", to: "slow-svc", props: { group: "slow" } },
      { id: "e4", from: "orders", to: "down-svc", props: { group: "down" } },
      { id: "e5", from: "orders", to: "paused-svc", props: { group: "paused" } },
      { id: "e6", from: "fast-svc", to: "fast-db" },
      { id: "e7", from: "jobs-api", to: "jobs" },
      { id: "e8", from: "jobs", to: "worker" },
      { id: "e9", from: "worker", to: "ledger" },
      { id: "e10", from: "jobs", to: "dlq", props: { dlq: true } },
    ],
    simulations: [sim],
  };
}

export type NoteState = "focus" | "pause" | "wide" | "free";

/** A short story on a fixture pipeline showing one narration state. */
export function noteStatesDiagram(state: NoteState): DiagramFile {
  const focus = state === "free" ? [] : state === "wide" ? ["shop", "db"] : ["topic"];
  const text =
    state === "pause"
      ? "The payments consumer is about to die. Watch its lag build while the other groups carry on."
      : state === "wide"
        ? "Every checkout travels from the storefront all the way to the database."
        : state === "free"
          ? "A note without focus nodes sits at the top of the canvas."
          : "The topic fans each order out to every consumer group.";
  return {
    format: DIAGRAM_FORMAT,
    title: "Narration",
    nodes: [
      { id: "shop", stencil: "client.browser", label: "Storefront", ...at(0, 1) },
      { id: "orders", stencil: "service.dotnet", label: "Order service", ...at(1, 1) },
      { id: "topic", stencil: "kafka.topic", label: "orders.created", ...at(2, 1) },
      { id: "pay", stencil: "service.go", label: "Payments", sublabel: "group: payments", ...at(3, 0) },
      { id: "mail", stencil: "service.node", label: "Notifications", sublabel: "group: mail", ...at(3, 2) },
      { id: "db", stencil: "postgres", label: "Payment ledger", ...at(4, 0) },
    ],
    edges: [
      { id: "n1", from: "shop", to: "orders", kind: "sync" },
      { id: "n2", from: "orders", to: "topic" },
      { id: "n3", from: "topic", to: "pay", props: { group: "payments" } },
      { id: "n4", from: "topic", to: "mail", props: { group: "mail" } },
      { id: "n5", from: "pay", to: "db" },
    ],
    simulations: [
      {
        id: "story",
        title: "Narration preview",
        seed: 7,
        traffic: [
          {
            id: "t",
            node: "shop",
            messageType: "OrderPlaced",
            shape: { kind: "constant", ratePerSec: 8, durationMs: 20_000 },
          },
        ],
        timeline: [{ atMs: 600, action: { do: "note", text, focus, pause: state === "pause" } }],
        durationMs: 30_000,
      },
    ],
  };
}
