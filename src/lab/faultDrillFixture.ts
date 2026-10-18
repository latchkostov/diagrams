import type { DiagramFile } from "../model/types";

/** Invented cross-zone traffic, shared by the Lab and browser fault regressions. */
export function faultDrillFixture(): DiagramFile {
  return {
    format: "diagrams/v1",
    title: "Fault drills",
    groups: [
      { id: "zone-a", label: "Zone a", x: 0, y: 20, width: 320, height: 430, tone: "azure" },
      { id: "zone-b", label: "Zone b", x: 540, y: 20, width: 320, height: 430, tone: "aws" },
    ],
    nodes: [
      {
        id: "caller",
        stencil: "client.user",
        label: "Caller",
        x: 40,
        y: 90,
        group: "zone-a",
        props: { ratePerSec: 0 },
      },
      { id: "queue", stencil: "rabbitmq.queue", label: "Buffered jobs", x: 40, y: 310, group: "zone-a" },
      {
        id: "worker",
        stencil: "service.dotnet",
        label: "Worker",
        x: 580,
        y: 90,
        group: "zone-b",
        props: { latencyMs: 100, concurrency: 100, failureRate: 0, jitter: 0 },
      },
      { id: "store", stencil: "postgres", label: "Orders", x: 580, y: 310, group: "zone-b", props: { latencyMs: 0 } },
    ],
    edges: [
      { id: "request", from: "caller", to: "worker", kind: "sync", label: "Request", props: { travelMs: 20 } },
      { id: "delivery", from: "queue", to: "worker", label: "Delivery", props: { travelMs: 20 } },
      { id: "write", from: "worker", to: "store", kind: "sync", label: "Store", props: { travelMs: 20 } },
    ],
    simulations: [
      {
        id: "drill",
        title: "Zone outage",
        seed: 7,
        durationMs: 6000,
        traffic: [],
        timeline: [
          {
            atMs: 3000,
            action: { do: "fault", fault: { kind: "boundary", boundary: "zone-b", down: true }, drill: "zone-outage" },
          },
        ],
      },
    ],
  };
}
