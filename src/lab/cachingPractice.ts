import type { DiagramFile } from "../model/types";
import type { CacheTable } from "../model/caching";
import { t } from "../i18n";
import stampede from "../examples/cache-stampede.json";
import { familyOf } from "../stencils/profileFamilies";

// Fixture names are public diagram data, fixed across languages.
/** Small public exercise: the same demand and origin in every cache comparison. */
export function cachingPractice(rule = true): DiagramFile {
  return {
    format: "diagrams/v2",
    title: t("tutorials.cdnCache.title"),
    planning: {
      revision: "p3-w3",
      requestRoutes: [{ id: "product", address: { method: "GET", path: "/products/example" } }],
    },
    nodes: [
      {
        id: "readers",
        stencil: "client.browser",
        label: "Product readers",
        x: 0,
        y: 100,
        props: { ratePerSec: 200, trafficMix: { mode: "shares", entries: [{ routeId: "product", share: 1 }] } },
      },
      {
        id: "edge",
        stencil: "generic.cdn",
        label: "Edge CDN",
        x: 320,
        y: 100,
        props: { latencyMs: 5, jitter: 0, ...(rule ? { cache: productCache() } : {}) },
      },
      {
        id: "origin",
        stencil: "generic.service",
        label: "Product API",
        x: 640,
        y: 100,
        props: { latencyMs: 80, jitter: 0, concurrency: 100 },
      },
    ],
    edges: [
      { id: "request", from: "readers", to: "edge", kind: "sync", props: { networkDelayMs: 10 } },
      { id: "fetch", from: "edge", to: "origin", kind: "sync", props: { networkDelayMs: 30 } },
    ],
    simulations: [
      {
        id: "cache-traffic",
        title: t("tutorials.caching.traffic"),
        seed: 7,
        scale: 1,
        durationMs: 600_000,
        traffic: [
          { id: "readers", node: "readers", shape: { kind: "constant", ratePerSec: 200, durationMs: 600_000 } },
        ],
      },
    ],
  };
}

export function productCache(): CacheTable {
  return {
    rules: [
      {
        id: "products",
        match: { methods: ["GET"], path: { kind: "template", value: "/products/{id}" } },
        policy: { ttlMs: 1000, keys: 20, popularity: "even" },
      },
    ],
  };
}

/** The public example's purge comparison already has stale copies in both rules. */
export function coldCachePractice(): DiagramFile {
  const d = structuredClone(stampede) as DiagramFile;
  const edge = d.nodes.find((n) => familyOf(n.stencil) === "edge")!;
  edge.props = { ...edge.props, ...d.simulations!.find((s) => s.id === "hard-purge")!.setup!.props![edge.id] };
  return d;
}
