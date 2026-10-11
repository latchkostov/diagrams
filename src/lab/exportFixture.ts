import type { DiagramFile } from "../model/types";

/** Complete saved-file contract, available as a Lab fixture and an independent e2e oracle. */
export const exportFixture: DiagramFile = {
  format: "diagrams/v1",
  title: "Complete export fixture",
  description: "All saved fields",
  direction: "TB",
  groups: [{ id: "zone", label: "Zone", tone: "neutral", x: 20, y: 20, width: 800, height: 300 }],
  nodes: [
    {
      id: "source",
      stencil: "client.browser",
      label: "Client",
      sublabel: "Requests",
      x: 60,
      y: 100,
      group: "zone",
      props: { ratePerSec: 7, messageType: "Request", custom: { retained: true } },
    },
    {
      id: "worker",
      stencil: "service.go",
      label: "Worker",
      sublabel: "API",
      x: 480,
      y: 100,
      group: "zone",
      props: { concurrency: 3, latencyMs: 40, emits: { Request: "Reply" } },
    },
  ],
  edges: [
    {
      id: "request",
      from: "source",
      to: "worker",
      label: "Call",
      kind: "sync",
      sourceSide: "bottom",
      targetSide: "left",
      props: { travelMs: 30, filter: ["Request"], emits: "Request" },
    },
  ],
  simulations: [
    {
      id: "saved",
      title: "Saved simulation",
      description: "Replay",
      seed: 7,
      durationMs: 5000,
      setup: { status: { worker: "up" }, props: { worker: { jitter: 0 } } },
      traffic: [
        {
          id: "burst",
          label: "Requests",
          node: "source",
          messageType: "Request",
          shape: { kind: "burst", count: 3, atMs: 100, spreadMs: 100 },
        },
      ],
      timeline: [
        { atMs: 0, action: { do: "note", text: "Start", focus: ["source"], pause: true } },
        { atMs: 300, action: { do: "props", node: "worker", props: { concurrency: 4 } } },
      ],
      expectations: [
        {
          id: "processed",
          label: "All processed",
          metric: { node: "worker", field: "processed" },
          op: "==",
          value: 3,
          when: "end",
        },
      ],
    },
  ],
};
