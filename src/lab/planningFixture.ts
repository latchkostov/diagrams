import type { DiagramFile } from "../model/types";

/** P1's three deliberate lessons, shared by the Lab and production browser regressions. */
export function planningFixture(kind: "orders" | "connections" | "no-reader" = "orders"): DiagramFile {
  const d: DiagramFile = {
    format: "diagrams/v1",
    title: "Planning: shared capacity",
    nodes: [
      { id: "checkout", stencil: "client.browser", label: "Checkout", x: 0, y: 140, props: { ratePerSec: 3 } },
      {
        id: "orders",
        stencil: "service.dotnet",
        label: "Orders",
        x: 640,
        y: 140,
        props: { latencyMs: 4000, jitter: 0 },
      },
    ],
    edges: [{ id: "request", from: "checkout", to: "orders", kind: "sync", props: { travelMs: 0 } }],
  };
  if (kind === "orders") return d;
  d.nodes.push({ id: "topic", stencil: "kafka.topic", label: "Order events", x: 320, y: 20 });
  d.edges = [{ id: "publish", from: "checkout", to: "topic", kind: "async", props: { travelMs: 0 } }];
  if (kind === "no-reader") {
    d.nodes = d.nodes.filter((n) => n.id !== "orders");
    return d;
  }
  d.nodes.push(
    { id: "topic2", stencil: "azure.service-bus.topic", label: "Returns", x: 320, y: 260 },
    { id: "payments", stencil: "generic.service", label: "Payments", x: 960, y: 140 },
    { id: "queue", stencil: "generic.queue", label: "Audit", x: 640, y: 400 },
  );
  d.edges.push(
    { id: "publish2", from: "checkout", to: "topic2", kind: "async" },
    { id: "consume", from: "topic", to: "orders", kind: "async", props: { group: "billing", filter: ["Checkout"] } },
    { id: "consume2", from: "topic2", to: "orders", kind: "async", props: { group: "returns" } },
    { id: "call", from: "orders", to: "payments", kind: "sync" },
    { id: "audit", from: "orders", to: "queue", kind: "async", props: { emits: "OrderHandled" } },
  );
  return d;
}
