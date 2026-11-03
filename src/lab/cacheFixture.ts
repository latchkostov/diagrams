import type { DiagramFile } from "../model/types";

/** Public, deterministic read-through path for the Lab and cache-core regressions. */
export function cacheFixture(): DiagramFile {
  return {
    format: "diagrams/v2",
    title: "Read-through cache",
    planning: { revision: "p3-w3" },
    nodes: [
      { id: "source", stencil: "client.browser", label: "Readers", x: 0, y: 100, props: { ratePerSec: 200 } },
      {
        id: "cache",
        stencil: "generic.cdn",
        label: "Edge cache",
        x: 320,
        y: 100,
        props: {
          latencyMs: 0,
          jitter: 0,
          cache: { rules: [], default: { ttlMs: 1000, keys: 20, popularity: "even" } },
        },
      },
      {
        id: "origin",
        stencil: "generic.database",
        label: "Origin",
        x: 640,
        y: 100,
        props: { latencyMs: 50, jitter: 0 },
      },
    ],
    edges: [
      { id: "input", from: "source", to: "cache", kind: "sync", props: { travelMs: 10 } },
      { id: "fetch", from: "cache", to: "origin", kind: "sync", props: { travelMs: 10 } },
    ],
  };
}
