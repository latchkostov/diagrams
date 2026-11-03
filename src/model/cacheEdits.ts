import type { DiagramFile } from "./types";
import type { CacheTable, CacheRule } from "./caching";
import { revisionAtLeast } from "./revisions";

export function newCacheRule(table: CacheTable): CacheRule {
  let n = 1;
  while (table.rules.some((r) => r.id === `cache-${n}`)) n++;
  return {
    id: `cache-${n}`,
    match: { methods: ["GET"], path: { kind: "template", value: "/products/{id}" } },
    policy: { ttlMs: 300_000, keys: 50_000, popularity: "typical" },
  };
}
export function withCacheRules(d: DiagramFile, id: string): DiagramFile {
  if (!revisionAtLeast(d.planning?.revision, "p3-w2")) return d;
  const table = { rules: [] };
  return {
    ...d,
    planning: { ...d.planning, revision: "p3-w3" },
    nodes: d.nodes.map((n) =>
      n.id === id && n.props?.cache === undefined
        ? { ...n, props: { ...n.props, cache: { rules: [newCacheRule(table)] } } }
        : n,
    ),
  };
}
