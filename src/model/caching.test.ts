import { expect, it } from "vitest";
import { cacheCapable, cacheProblem } from "./caching";
import { validateCacheDocument } from "./cacheValidation";
import { cacheFixture } from "../lab/cacheFixture";
import { legacyExport, upgradeCaching, cacheUpgradeNodes } from "../planning/migration";
import { describeDiagram } from "../ai/describe";
import { emptyDiagram } from "../lib/diagramIO";

it.each([
  "generic.cdn",
  "cloudflare",
  "azure.front-door",
  "fastly",
  "akamai",
  "aws.cloudfront",
  "bunny.cdn",
  "gcp.cloud-cdn",
])("edge capability inherits through %s", (stencil) => {
  expect(cacheCapable(stencil, "gateway")).toBe(true);
});
it.each(["generic.cache", "redis.cache", "azure.redis", "memcached", "valkey"])(
  "store capability inherits through %s",
  (stencil) => {
    expect(cacheCapable(stencil, "store")).toBe(true);
  },
);
it.each([
  {},
  { ttlMs: 99 },
  { ttlMs: 86_400_001 },
  { ttlMs: 1000, noStore: true },
  { ttlMs: 1000, keys: 0 },
  { ttlMs: 1000, keys: 1_000_001 },
  { ttlMs: 1000, popularity: "custom" },
  { ttlMs: 1000, coalesce: "yes" },
  { ttlMs: 1000, staleWhileRevalidateMs: 1000 },
])("rejects unsupported cache policy %j", (policy) => {
  expect(cacheProblem({ rules: [], default: policy })).toBeDefined();
});
it.each([true, false])("accepts the explicit coalescing option %s", (coalesce) => {
  expect(cacheProblem({ rules: [], default: { ttlMs: 1000, coalesce } })).toBeUndefined();
});
it("validates bounds and every persisted setup/timeline context", () => {
  const d = cacheFixture();
  expect(validateCacheDocument(d)).toBeUndefined();
  d.nodes[1].stencil = "nginx";
  expect(validateCacheDocument(d)).toContain("cannot cache");
  d.nodes[1].stencil = "generic.cdn";
  const rule = { id: "page", match: { types: ["Page*"] }, policy: { ttlMs: 1000 } };
  expect(cacheProblem({ rules: [rule, rule] })).toContain("unique");
  expect(cacheProblem({ rules: Array.from({ length: 33 }, (_, id) => ({ ...rule, id: String(id) })) })).toBeDefined();
  d.simulations = [
    {
      id: "patch",
      title: "Patch",
      seed: 7,
      traffic: [],
      timeline: [
        { atMs: 1000, action: { do: "props", node: "cache", props: { cache: { rules: [], default: { ttlMs: 1 } } } } },
      ],
    },
  ];
  expect(validateCacheDocument(d)).toContain("cache");
});
it("new diagrams choose W3; upgrades and legacy stripping preserve the original", () => {
  expect(emptyDiagram().planning?.revision).toBe("p3-w3");
  const d = cacheFixture();
  d.planning!.revision = "p3-w2";
  const next = upgradeCaching(d);
  expect(next.planning!.revision).toBe("p3-w3");
  expect(d.planning!.revision).toBe("p3-w2");
  expect(legacyExport(next).diagram.nodes[1].props!.cache).toBeUndefined();
  expect(next.nodes[1].props!.cache).toBeDefined();
  expect(JSON.parse(describeDiagram(next, { format: "json" })).nodes[1].cache.origin).toEqual(["fetch"]);
});

it("upgrade previews exclude dormant/no-store tables and include saved storing overrides", () => {
  const d = cacheFixture();
  expect(cacheUpgradeNodes(d)).toEqual([{ nodeId: "cache", node: "Edge cache" }]);
  d.nodes[1].props!.cache = { rules: [], default: { noStore: true } };
  expect(cacheUpgradeNodes(d)).toEqual([]);
  d.simulations = [
    {
      id: "warm",
      title: "Warm",
      traffic: [],
      setup: { props: { cache: { cache: { rules: [], default: { ttlMs: 1000 } } } } },
    },
  ];
  expect(cacheUpgradeNodes(d)).toEqual([{ nodeId: "cache", node: "Edge cache", simulation: "Warm" }]);
  d.edges = d.edges.filter((e) => e.id !== "fetch");
  expect(cacheUpgradeNodes(d)).toEqual([]);
});

it.each(["setup", "timeline"])("refuses stencil edits with %s-only cache rules before saving", async (where) => {
  const { createRoutingValidator } = await import("./routingValidation");
  const { validateDiagram } = await import("../interop/native");
  const d = cacheFixture();
  const cache = d.nodes[1].props!.cache;
  delete d.nodes[1].props!.cache;
  d.simulations = [
    {
      id: "saved",
      title: "Saved",
      traffic: [],
      ...(where === "setup"
        ? { setup: { props: { cache: { cache } } } }
        : { timeline: [{ atMs: 1000, action: { do: "props" as const, node: "cache", props: { cache } } }] }),
    },
  ];
  const validate = createRoutingValidator();
  expect(validate(d)).toBeUndefined();
  const edited = { ...d, title: "Keep this edit" };
  expect(validate(edited)).toBeUndefined();
  const invalid = {
    ...edited,
    nodes: edited.nodes.map((n) => (n.id === "cache" ? { ...n, stencil: "generic.service" } : n)),
  };
  expect(validate(invalid)).toContain("cannot cache");
  // The editor retains the last accepted candidate; the saved document still reloads with every edit.
  const reloaded = validateDiagram(JSON.parse(JSON.stringify(edited)));
  expect(reloaded.ok).toBe(true);
  if (reloaded.ok) expect(reloaded.diagram).toEqual(edited);
  expect(validate({ ...edited, nodes: edited.nodes.filter((n) => n.id !== "cache") })).toBeDefined();
});
