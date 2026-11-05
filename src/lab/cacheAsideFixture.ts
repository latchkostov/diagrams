import type { DiagramFile } from "../model/types";

/** Public cache-aside path: every read looks up the cache; only misses read the database. */
export function cacheAsideFixture(): DiagramFile {
  return {
    format: "diagrams/v2",
    title: "Look up, then fetch",
    planning: { revision: "p3-w3" },
    nodes: [
      { id: "source", stencil: "client.browser", label: "Readers", x: 0, y: 100, props: { ratePerSec: 200 } },
      {
        id: "service",
        stencil: "generic.service",
        label: "Catalog",
        x: 280,
        y: 100,
        props: { latencyMs: 10, jitter: 0, concurrency: 100, failureRate: 0 },
      },
      {
        id: "cache",
        stencil: "generic.cache",
        label: "Product cache",
        x: 560,
        y: 0,
        props: { latencyMs: 20, jitter: 0, cache: { rules: [], default: { ttlMs: 1000, keys: 1 } } },
      },
      {
        id: "database",
        stencil: "generic.database",
        label: "Catalog database",
        x: 560,
        y: 220,
        props: { latencyMs: 100, jitter: 0 },
      },
    ],
    edges: [
      { id: "input", from: "source", to: "service", kind: "sync", props: { travelMs: 10 } },
      {
        id: "lookup",
        from: "service",
        to: "cache",
        kind: "sync",
        props: { travelMs: 10, caller: { wait: "blocking" } },
      },
      {
        id: "fetch",
        from: "service",
        to: "database",
        kind: "sync",
        props: { travelMs: 10, caller: { wait: "blocking", onMiss: "lookup" } },
      },
    ],
  };
}
