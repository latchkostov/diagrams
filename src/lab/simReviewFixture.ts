import type { DiagramFile } from "../model/types";

/** Review regression: one exhausted delivery, with optional diagnostic-only losses. */
export function simReviewFixture(diagnostic = false): DiagramFile {
  return {
    format: "diagrams/v1",
    title: "Delivery losses",
    nodes: [
      {
        id: "web",
        stencil: "client.browser",
        label: "Web",
        x: 0,
        y: 100,
        props: { ratePerSec: 2, messageType: "Order" },
      },
      { id: "q", stencil: "aws.sqs", label: "orders", x: 400, y: 100, props: { maxDeliveryCount: 1 } },
      {
        id: "worker",
        stencil: "service.go",
        label: "Worker",
        x: 800,
        y: 100,
        props: { failureRate: 1, latencyMs: 10, concurrency: 1, jitter: 0 },
      },
      ...(diagnostic ? [{ id: "dlq", stencil: "aws.sqs", label: "orders-dlq", x: 400, y: 400 }] : []),
    ],
    edges: [
      { id: "web-q", from: "web", to: "q", kind: "async", props: { travelMs: 20 } },
      { id: "q-worker", from: "q", to: "worker", kind: "async", props: { travelMs: 20 } },
      ...(diagnostic
        ? [{ id: "dead", from: "q", to: "dlq", kind: "async" as const, props: { dlq: true, filter: ["Other"] } }]
        : []),
    ],
  };
}

export function simReviewTrafficFixture(ratePerSec = 10_000_000): DiagramFile {
  const d = simReviewFixture();
  d.nodes = d.nodes.filter((n) => n.id !== "worker");
  d.nodes[0].props = { ratePerSec };
  d.edges = [d.edges[0]];
  d.simulations = [
    { id: "budget", title: "Continuous traffic budget", seed: 1, scale: 1, durationMs: 30_000, traffic: [] },
  ];
  return d;
}
