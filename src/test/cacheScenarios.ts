import fc from "fast-check";
import { arbResilienceDiagram } from "./resilienceScenarios";

/** Cache core inherits the existing retries, breakers, pools, queues and CPU contention generator. */
export const arbCacheDiagram = fc
  .tuple(
    arbResilienceDiagram,
    fc.record({
      ttlMs: fc.integer({ min: 100, max: 5000 }),
      keys: fc.integer({ min: 1, max: 1000 }),
      popularity: fc.constantFrom("even" as const, "gentle" as const, "typical" as const, "steep" as const),
      noStore: fc.boolean(),
      coalesce: fc.boolean(),
    }),
  )
  .map(([base, policy]) => {
    const diagram = structuredClone(base.diagram);
    diagram.planning!.revision = "p3-w3";
    diagram.nodes[0].stencil = "client.browser";
    diagram.nodes[0].props = { ratePerSec: 0 };
    diagram.nodes.push({
      id: "cache",
      stencil: "generic.cdn",
      label: "Cache",
      x: 160,
      y: 0,
      props: {
        latencyMs: 0,
        jitter: 0,
        cache: {
          rules: [],
          default: policy.noStore
            ? { noStore: true }
            : { ttlMs: policy.ttlMs, keys: policy.keys, popularity: policy.popularity, coalesce: policy.coalesce },
        },
      },
    });
    const input = diagram.edges.find((e) => e.id === "input")!;
    input.to = "cache";
    input.kind = "sync";
    diagram.edges.push({
      id: "cache-origin",
      from: "cache",
      to: "tier0",
      kind: "sync",
      props: { travelMs: 10, caller: { deadlineMs: base.deadlineMs ?? 2000 } },
    });
    return { ...base, diagram };
  });
