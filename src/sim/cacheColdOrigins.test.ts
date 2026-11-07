import fc from "fast-check";
import { expect, it } from "vitest";
import type { DiagramEdge, DiagramFile, DiagramNode } from "../model/types";
import type { CacheTable } from "../model/caching";
import { cacheAsideOrigins } from "../model/cacheAside";
import { cacheFixture } from "../lab/cacheFixture";
import { cacheAsideFixture } from "../lab/cacheAsideFixture";
import { propertyRuns } from "../test/fastCheck";
import { stencilRole } from "../stencils/roles";
import { analyzeCapacity } from "./capacity";

/** What propagation itself sends to each origin with every cache cold: the same diagram with every rule no-store. */
function coldTruth(d: DiagramFile): Record<string, number> {
  const cold = structuredClone(d);
  const caches = cold.nodes.filter((n) => n.props?.cache);
  for (const node of caches) {
    const table = node.props!.cache as CacheTable;
    node.props!.cache = {
      rules: table.rules.map((rule) => ({ ...rule, policy: { noStore: true } })),
      ...(table.default ? { default: { noStore: true } } : {}),
    };
  }
  const connections = analyzeCapacity(cold).connections;
  const out: Record<string, number> = {};
  const origins = new Set<DiagramEdge>();
  for (const node of caches) {
    for (const edge of cold.edges)
      if (edge.from === node.id && edge.kind === "sync" && !edge.props?.dlq) origins.add(edge);
    for (const edge of cacheAsideOrigins(cold, node.id)) origins.add(edge);
  }
  for (const edge of origins) if (connections[edge.id] > 0) out[edge.to] = (out[edge.to] ?? 0) + connections[edge.id];
  return out;
}

/** The projection Checks read: cold origin demand summed over every cache rule. */
function projection(d: DiagramFile): Record<string, number> {
  const out: Record<string, number> = {};
  for (const byRule of Object.values(analyzeCapacity(d).cacheDemand ?? {}))
    for (const item of Object.values(byRule))
      for (const [origin, demand] of Object.entries(item.origins ?? {})) out[origin] = (out[origin] ?? 0) + demand.rate;
  return out;
}

function expectAgreement(d: DiagramFile) {
  const truth = coldTruth(d),
    projected = projection(d);
  expect(Object.keys(projected).sort()).toEqual(Object.keys(truth).sort());
  for (const [origin, rate] of Object.entries(truth)) expect(projected[origin], origin).toBeCloseTo(rate, 6);
}

const service = (id: string, latencyMs = 10): DiagramNode => ({
  id,
  stencil: "generic.service",
  label: id,
  x: 0,
  y: 0,
  props: { latencyMs, concurrency: 1000, replicas: 1, jitter: 0 },
});
const source = (id: string, ratePerSec: number): DiagramNode => ({
  id,
  stencil: "client.browser",
  label: id,
  x: 0,
  y: 0,
  props: { ratePerSec },
});
const call = (id: string, from: string, to: string, props: DiagramEdge["props"] = {}): DiagramEdge => ({
  id,
  from,
  to,
  kind: "sync",
  props: { ...props, caller: { wait: "blocking", ...(props?.caller as object) } },
});

/** A cache-aside caller: its own entry traffic, a lookup into the shared cache and a conditional origin call. */
function addCaller(
  d: DiagramFile,
  id: string,
  rate: number,
  origin: string,
  options: { lookupShare?: number; originShare?: number; rename?: boolean } = {},
) {
  d.nodes.push(source(`${id}-readers`, rate), service(id));
  if (!d.nodes.some((n) => n.id === origin)) d.nodes.push(service(origin, 100));
  d.edges.push(
    call(`${id}-input`, `${id}-readers`, id),
    call(`${id}-lookup`, id, "cache", {
      ...(options.lookupShare !== undefined ? { share: options.lookupShare } : {}),
      ...(options.rename ? { emits: "CacheRead" } : {}),
    }),
    call(`${id}-fetch`, id, origin, {
      ...(options.originShare !== undefined ? { share: options.originShare } : {}),
      caller: { onMiss: `${id}-lookup` },
    }),
  );
}

/** A cache with no callers yet. */
function sharedCache(): DiagramFile {
  const d = cacheAsideFixture();
  d.nodes = d.nodes.filter((n) => n.id === "cache");
  d.edges = [];
  return d;
}

const TOPOLOGIES: [string, () => DiagramFile][] = [
  [
    "read-through store with fractional connection shares",
    () => {
      const d = cacheFixture();
      d.nodes[1].stencil = "generic.cache";
      d.edges.find((e) => e.id === "fetch")!.props!.share = 0.1;
      d.nodes.push(service("backup"));
      d.edges.push(call("backup-fetch", "cache", "backup", { share: 0.5 }));
      return d;
    },
  ],
  [
    "CDN splitting between two origins and an async audit feed",
    () => {
      const d = cacheFixture();
      d.nodes.push(service("second"), { ...service("audit"), stencil: "generic.queue" });
      d.edges.push(call("second-fetch", "cache", "second"), {
        id: "audit-feed",
        from: "cache",
        to: "audit",
        kind: "async",
      });
      return d;
    },
  ],
  [
    "CDN with health checks routing around a down origin",
    () => {
      const d = cacheFixture();
      d.nodes[1].props!.healthChecks = true;
      d.nodes.push(service("second"), { ...service("third"), props: { ...service("third").props, status: "down" } });
      d.edges.push(call("second-fetch", "cache", "second"), call("third-fetch", "cache", "third"));
      return d;
    },
  ],
  [
    "CDN routing rules with weighted targets",
    () => {
      const d = cacheFixture();
      d.planning!.requestRoutes = [
        { id: "launch", address: { method: "GET", path: "/launch" } },
        { id: "static", address: { method: "GET", path: "/static" } },
      ];
      d.nodes[0].props!.trafficMix = {
        mode: "shares",
        entries: [
          { routeId: "launch", share: 0.7 },
          { routeId: "static", share: 0.3 },
        ],
      };
      d.nodes.push(service("static-origin"), service("canary"));
      d.edges.push(call("static-fetch", "cache", "static-origin"), call("canary-fetch", "cache", "canary"));
      d.nodes[1].props!.cache = {
        rules: [{ id: "static", match: { path: { kind: "exact", value: "/static" } }, policy: { ttlMs: 1000 } }],
        default: { ttlMs: 500, keys: 20 },
      };
      d.nodes[1].props!.routeTable = {
        rules: [
          {
            id: "static",
            match: { path: { kind: "exact", value: "/static" } },
            targets: [{ edgeId: "static-fetch", weight: 1 }],
          },
        ],
        default: {
          targets: [
            { edgeId: "fetch", weight: 3 },
            { edgeId: "canary-fetch", weight: 1 },
          ],
        },
      };
      return d;
    },
  ],
  [
    "cache-aside with shares on the lookup and the origin call",
    () => {
      const d = sharedCache();
      addCaller(d, "catalog", 200, "database", { lookupShare: 0.5, originShare: 0.4 });
      return d;
    },
  ],
  [
    "two callers sharing one cache, each with its own origin",
    () => {
      const d = sharedCache();
      addCaller(d, "a", 300, "database-a");
      addCaller(d, "b", 30, "database-b");
      return d;
    },
  ],
  [
    "three callers, two sharing an origin, with fractional shares",
    () => {
      const d = sharedCache();
      addCaller(d, "a", 300, "database-a", { originShare: 0.5 });
      addCaller(d, "b", 30, "database-a", { lookupShare: 0.25 });
      addCaller(d, "c", 70, "database-c", { originShare: 0.2, lookupShare: 0.5 });
      return d;
    },
  ],
  [
    "renamed lookup with a message-type filter on the origin call",
    () => {
      const d = sharedCache();
      addCaller(d, "a", 120, "database-a", { rename: true });
      d.nodes.find((n) => n.id === "a")!.props!.emits = "Read";
      d.edges.find((e) => e.id === "a-fetch")!.props!.filter = ["Read"];
      addCaller(d, "b", 40, "database-b");
      return d;
    },
  ],
  [
    "routed callers with request filters on their origin calls",
    () => {
      const d = sharedCache();
      d.planning!.requestRoutes = [
        { id: "read", address: { method: "GET", path: "/products/one" } },
        { id: "write", address: { method: "POST", path: "/products/one" } },
      ];
      addCaller(d, "a", 100, "database-a");
      addCaller(d, "b", 60, "database-b");
      d.nodes.find((n) => n.id === "a-readers")!.props!.trafficMix = {
        mode: "shares",
        entries: [
          { routeId: "read", share: 0.75 },
          { routeId: "write", share: 0.25 },
        ],
      };
      d.edges.find((e) => e.id === "a-fetch")!.props!.requestFilter = { methods: ["GET"] };
      d.edges.find((e) => e.id === "b-lookup")!.props!.requestRouteId = "read";
      (d.nodes.find((n) => n.id === "cache")!.props!.cache as CacheTable).rules = [
        { id: "reads", match: { methods: ["GET"] }, policy: { ttlMs: 2000, keys: 10 } },
      ];
      return d;
    },
  ],
  [
    "cache-aside callers and direct read-through traffic on one cache",
    () => {
      const d = sharedCache();
      addCaller(d, "a", 150, "database-a");
      d.nodes.push(source("direct", 25));
      d.edges.push(call("direct-lookup", "direct", "cache"), call("cache-origin", "cache", "database-a"));
      return d;
    },
  ],
  [
    "a router as a cache-aside caller beside a service caller",
    () => {
      const d = sharedCache();
      addCaller(d, "a", 90, "database-a");
      addCaller(d, "router", 40, "database-b");
      d.nodes.find((n) => n.id === "router")!.stencil = "generic.router";
      expect(stencilRole("generic.router")).toBe("gateway");
      return d;
    },
  ],
];

it.each(TOPOLOGIES)("cold origin demand matches cold propagation: %s", (_, build) => expectAgreement(build()));

it("keeps each cache-aside caller's demand on its own origin", () => {
  const d = sharedCache();
  addCaller(d, "a", 300, "database-a");
  addCaller(d, "b", 30, "database-b");
  const origins = analyzeCapacity(d).cacheDemand!.cache[""].origins!;
  expect(origins["database-a"]).toMatchObject({ rate: 300, edge: "a-fetch" });
  expect(origins["database-b"]).toMatchObject({ rate: 30, edge: "b-fetch" });
});

it("cold origin demand matches cold propagation for any mix of cache-aside callers", () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          rate: fc.integer({ min: 1, max: 500 }),
          origin: fc.constantFrom("database-a", "database-b", "database-c"),
          lookupShare: fc.option(fc.constantFrom(0.25, 0.5, 1), { nil: undefined }),
          originShare: fc.option(fc.constantFrom(0.1, 0.5, 1), { nil: undefined }),
          rename: fc.boolean(),
        }),
        { minLength: 1, maxLength: 4 },
      ),
      fc.option(fc.integer({ min: 1, max: 100 }), { nil: undefined }),
      (callers, direct) => {
        const d = sharedCache();
        callers.forEach((c, i) => addCaller(d, `caller-${i}`, c.rate, c.origin, c));
        if (direct) {
          if (!d.nodes.some((n) => n.id === "database-a")) d.nodes.push(service("database-a", 100));
          d.nodes.push(source("direct", direct));
          d.edges.push(call("direct-lookup", "direct", "cache"), call("cache-origin", "cache", "database-a"));
        }
        expectAgreement(d);
      },
    ),
    { numRuns: propertyRuns(40) },
  );
});
