import type { DiagramFile } from "../model/types";
import { newPlanningProps } from "../model/planning";

/** Public deterministic review fixture: slow calls exhaust account concurrency before RPS. */
export function planningP3Fixture(stencil = "stripe"): DiagramFile {
  const planning = { revision: "p3" as const };
  return {
    format: "diagrams/v2",
    planning,
    title: "Managed admission",
    nodes: [
      { id: "source", stencil: "client.browser", label: "Checkout", x: 0, y: 130, props: { ratePerSec: 20 } },
      {
        id: "api",
        stencil,
        label: stencil === "stripe" ? "Stripe" : stencil,
        x: 330,
        y: 130,
        props: {
          ...newPlanningProps(
            stencil === "aws.lambda" || stencil === "openai" ? "processor" : "sink",
            planning,
            stencil,
          ),
          latencyMs: 1000,
          jitter: 0,
          ...(stencil === "generic.external-api"
            ? {
                api: {
                  maxInFlight: 2,
                  quotas: [
                    { id: "local-rate", unit: "requests", amount: 10, windowMs: 1000, algorithm: "token-bucket" },
                  ],
                },
              }
            : {}),
        },
      },
    ],
    edges: [
      {
        id: "call",
        from: "source",
        to: "api",
        kind: "sync",
        props: {
          travelMs: 0,
          caller: {
            deadlineMs: 1,
            retry: { maxAttempts: 3, strategy: "exponential", backoffMs: 100, retryOn: ["throttled"] },
          },
        },
      },
    ],
  };
}
