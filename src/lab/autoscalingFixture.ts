import type { DiagramFile } from "../model/types";
import { hpaLesson, resourceLesson } from "../model/autoscaling";
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
