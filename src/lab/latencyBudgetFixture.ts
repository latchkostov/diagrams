import type { DiagramFile } from "../model/types";

/** Small input with a wide completion population: 200 sinks × 64 message types. */
export function latencyBudgetFixture(): DiagramFile {
  return {
    format: "diagrams/v1",
    title: "Fan-out latency budget",
    nodes: [
      { id: "source", stencil: "source", label: "Source", x: 0, y: 0 },
      ...Array.from({ length: 200 }, (_, i) => ({
        id: `sink-${i}`,
        stencil: "sink",
        label: `Sink ${i}`,
        x: 300,
        y: i * 100,
      })),
    ],
    edges: Array.from({ length: 200 }, (_, i) => ({
      id: `edge-${i}`,
      from: "source",
      to: `sink-${i}`,
      kind: "async" as const,
      props: { travelMs: 10 },
    })),
    simulations: [
      {
        id: "fan-out",
        title: "Fan-out",
        seed: 7,
        scale: 1,
        durationMs: 130000,
        traffic: Array.from({ length: 64 }, (_, i) => ({
          id: `traffic-${i}`,
          node: "source",
          messageType: `Type ${i}`,
          shape: { kind: "burst" as const, count: 1, atMs: i * 10 },
        })),
      },
    ],
  };
}
