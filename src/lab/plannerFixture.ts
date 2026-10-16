import { autoscalingFixture } from "./autoscalingFixture";
import type { DiagramFile } from "../model/types";

/**
 * The research's worked example (docs/research/autoscaling.md §3): at 3× traffic an HPA service with a 70% CPU
 * target hits max 10 at 92% of its 500m request; the planner should say "raise max to 14". 115 msg/s × 40 CPU-ms over
 * ten replicas is 460m each. Variants put the same burst behind a ten-partition log, or an admission quota.
 */
export function plannerFixture(variant: "http" | "partitions" | "quota" = "http", rate = 115 / 3): DiagramFile {
  const d = autoscalingFixture();
  d.title = "Black Friday sizing";
  d.nodes[0].props = { ratePerSec: 0 };
  if (variant === "partitions") {
    Object.assign(d.nodes[0], { id: "orders", stencil: "kafka.topic", label: "Orders", props: { partitions: 10 } });
    d.edges = [
      { id: "consume", from: "orders", to: "worker", kind: "async", props: { group: "fulfil", travelMs: 10 } },
    ];
  }
  if (variant === "quota")
    d.nodes[1].props!.api = {
      quotas: [{ id: "requests", unit: "requests", amount: 100, windowMs: 1000, burst: 1, algorithm: "token-bucket" }],
    };
  d.simulations = [
    {
      id: "black-friday",
      title: "Black Friday",
      seed: 7,
      multipliers: { traffic: 3 },
      durationMs: 240_000,
      traffic: [
        {
          id: "shoppers",
          node: d.nodes[0].id,
          shape: { kind: "constant", ratePerSec: rate, durationMs: 240_000 },
        },
      ],
    },
  ];
  return d;
}
