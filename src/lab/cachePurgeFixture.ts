import stampede from "../examples/cache-stampede.json" with { type: "json" };
import type { DiagramFile } from "../model/types";

export function staleCalloutFixture(seed = 1): DiagramFile {
  const d = structuredClone(stampede) as DiagramFile;
  d.nodes.find((n) => n.id === "origin")!.props!.latencyMs = 300;
  d.nodes[0].props!.trafficMix = {
    mode: "shares",
    entries: [
      { routeId: "launch", share: 0.99 },
      { routeId: "products", share: 0.01 },
    ],
  };
  d.simulations![0] = {
    ...d.simulations![0],
    seed,
    traffic: [{ id: "shoppers", node: "shoppers", shape: { kind: "constant", ratePerSec: 100, durationMs: 40000 } }],
  };
  return d;
}

/** Rules live only in the saved setup; their valid IDs also resemble menu sentinels. */
export function purgeEditorFixture(): DiagramFile {
  const d = structuredClone(stampede) as DiagramFile;
  delete d.nodes.find((n) => n.id === "cdn")!.props!.cache;
  d.simulations = [
    {
      id: "purge-rules",
      title: "Purge scope",
      durationMs: 40000,
      traffic: [],
      setup: {
        props: {
          cdn: {
            cache: {
              rules: ["__all", "all", "default"].map((id) => ({
                id,
                label: id,
                match: { path: { kind: "exact", value: `/${id}` } },
                policy: { ttlMs: 10000, keys: 1 },
              })),
              default: { ttlMs: 10000, keys: 1 },
            },
          },
        },
      },
    },
  ];
  return d;
}
