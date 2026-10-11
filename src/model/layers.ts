import type { DiagramAnnotation, DiagramNode } from "./types";

type Layers = {
  nodes: Pick<DiagramNode, "id">[];
  annotations?: Pick<DiagramAnnotation, "id" | "kind">[];
  layerOrder?: string[];
};

/** Foreground only, back to front; boundaries and zones always remain backdrops. */
export function defaultLayerOrder(d: Layers): string[] {
  return [...d.nodes.map((n) => n.id), ...(d.annotations ?? []).filter((a) => a.kind !== "zone").map((a) => a.id)];
}

/** Validate/filter optional ordering without accepting stale ids, backdrops or duplicates. */
export function filterLayerOrder(value: unknown, d: Layers): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const allowed = new Set(defaultLayerOrder(d));
  const seen = new Set<string>();
  return value.filter((id): id is string => {
    if (typeof id !== "string" || !allowed.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** Complete a partial order with the remaining foreground in its default order. */
export function foregroundLayerOrder(d: Layers): string[] {
  const order = filterLayerOrder(d.layerOrder, d) ?? [];
  const seen = new Set(order);
  return [...order, ...defaultLayerOrder(d).filter((id) => !seen.has(id))];
}
