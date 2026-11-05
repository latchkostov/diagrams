import type { DiagramEdge, DiagramFile } from "./types";
import type { EdgeSimProps } from "../sim/types";
import { cacheCapable } from "./caching";
import { stencilRole } from "../stencils/roles";

export const onMiss = (edge: Pick<DiagramEdge, "props">): string | undefined =>
  (edge.props?.caller as EdgeSimProps["caller"])?.onMiss ?? undefined;

/** The database calls filled through lookups at this cache (ordinary read-through origins stay separate). */
export function cacheAsideOrigins(d: Pick<DiagramFile, "edges">, cache: string) {
  const lookups = new Set(d.edges.filter((e) => e.to === cache).map((e) => e.id));
  return d.edges.filter((e) => lookups.has(onMiss(e) ?? ""));
}

export function cacheLookupChoices(d: Pick<DiagramFile, "nodes" | "edges">, id: string) {
  const edge = d.edges.find((e) => e.id === id);
  if (!edge || edge.kind !== "sync" || (edge.relation && edge.relation !== "flow")) return [];
  return d.edges.flatMap((lookup) => {
    const cache = d.nodes.find((n) => n.id === lookup.to);
    return lookup.id !== id &&
      lookup.from === edge.from &&
      lookup.kind === "sync" &&
      (!lookup.relation || lookup.relation === "flow") &&
      !lookup.props?.dlq &&
      !onMiss(lookup) &&
      cache &&
      cacheCapable(cache.stencil, stencilRole(cache.stencil))
      ? [{ id: lookup.id, label: cache.label || cache.id }]
      : [];
  });
}

/** References are checked even while dormant, so an upgrade cannot activate a broken call. */
export function cacheAsideProblem(d: Pick<DiagramFile, "nodes" | "edges">): string | undefined {
  const edges = new Map(d.edges.map((e) => [e.id, e]));
  const nodes = new Map(d.nodes.map((n) => [n.id, n]));
  for (const edge of d.edges) {
    const ref = onMiss(edge);
    if (ref === undefined) continue;
    const lookup = edges.get(ref);
    const cache = lookup && nodes.get(lookup.to);
    if (
      typeof ref !== "string" ||
      !ref ||
      !lookup ||
      lookup === edge ||
      lookup.from !== edge.from ||
      edge.kind !== "sync" ||
      lookup.kind !== "sync" ||
      (edge.relation && edge.relation !== "flow") ||
      (lookup.relation && lookup.relation !== "flow") ||
      edge.props?.dlq ||
      lookup.props?.dlq ||
      onMiss(lookup) !== undefined ||
      !cache ||
      !cacheCapable(cache.stencil, stencilRole(cache.stencil))
    )
      return `${edge.id}.caller.onMiss: choose this caller's Request to a cache; conditional lookups and cycles are not allowed`;
  }
}
