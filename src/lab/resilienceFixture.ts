import type { DiagramFile } from "../model/types";
import { waitingFixture } from "./waitingFixture";

/** Retry diagnostics within a second, without a large showcase queue. */
export function resilienceFixture(): DiagramFile {
  const d = waitingFixture();
  d.planning!.revision = "p3-w2";
  d.nodes[0].props!.ratePerSec = 100;
  d.nodes[1].props!.concurrency = 100;
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = { concurrency: 100, latencyMs: 30, jitter: 0, failureRate: 1 };
  d.edges[1].props = {
    travelMs: 10,
    caller: {
      wait: "non-blocking",
      deadlineMs: 200,
      retry: {
        maxAttempts: 3,
        backoffMs: 100,
        strategy: "exponential",
        jitter: 1,
        retryOn: ["timeout", "transient", "throttled"],
      },
    },
  };
  return d;
}

/** An inherited breaker and a saved run for explicit On/Off overrides. */
export function breakerFixture(): DiagramFile {
  const d = resilienceFixture();
  const caller = d.edges[1].props!.caller as NonNullable<import("../sim/types").EdgeSimProps["caller"]>;
  caller.breaker = { minimumCalls: 1, openMs: 1000 };
  d.simulations = [{ id: "breaker", title: "Breaker override", durationMs: 10000, traffic: [] }];
  return d;
}

/** Bounded queue and fast refusals in the first second; no external system is modeled. */
export function sheddingFixture(): DiagramFile {
  const d = resilienceFixture();
  d.nodes[2].props = {
    concurrency: 1,
    replicas: 1,
    latencyMs: 200,
    jitter: 0,
    queue: { limit: 3, order: "lifo", maxWaitMs: 50 },
  };
  d.simulations = [
    {
      id: "shedding",
      title: "Queue override",
      durationMs: 10000,
      traffic: [],
      setup: { props: { partner: { queue: { limit: 2, order: "lifo", maxWaitMs: 50 } } } },
    },
  ];
  return d;
}
