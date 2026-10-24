import type { DiagramFile } from "../model/types";
import { hpaLesson, resourceLesson } from "../model/autoscalingLessons";
export function autoscalingFixture(): DiagramFile {
  return {
    format: "diagrams/v2",
    planning: { revision: "p3-a1" },
    title: "HPA service",
    nodes: [
      { id: "source", stencil: "client.browser", label: "Traffic", x: 80, y: 180, props: { ratePerSec: 80 } },
      {
        id: "worker",
        stencil: "service.dotnet",
        label: "Orders",
        x: 440,
        y: 180,
        props: {
          replicas: 1,
          concurrency: 4,
          latencyMs: 250,
          jitter: 0,
          resources: resourceLesson(),
          autoscaling: hpaLesson(),
        },
      },
    ],
    edges: [{ id: "requests", from: "source", to: "worker", kind: "sync", props: { travelMs: 10 } }],
  };
}

/** Hostile cross-product fixture: partial jittered readiness plus a large real-message burst. */
export function sampledCpuBudgetFixture(): DiagramFile {
  const d = autoscalingFixture();
  d.nodes[0].props!.ratePerSec = 0;
  Object.assign(d.nodes[1].props!, {
    autoscaling: { mode: "off" },
    resources: { ...resourceLesson(), cpuMsPerMessage: 600_000, startup: { delayMs: 5000, jitterFraction: 0.5 } },
  });
  d.simulations = [
    {
      id: "cpu-budget",
      title: "CPU budget",
      scale: 10,
      durationMs: 10_000,
      traffic: [],
      timeline: [
        { atMs: 10, action: { do: "props", node: "worker", props: { replicas: 10_000 } } },
        { atMs: 5010, action: { do: "inject", node: "source", count: 2000 } },
      ],
    },
  ];
  return d;
}
