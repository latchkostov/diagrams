// Graph walks for the live view: "Trace this path" and narration focus.

import { flowEdges } from "../model/relations";
import type { DiagramEdge } from "../model/types";

export interface Reach {
  nodes: Set<string>;
  edges: Set<string>;
}

/** Everything downstream of an edge: the edge itself, its target, and all that follows from it. */
export function downstreamOfEdge(
  edges: readonly Pick<DiagramEdge, "id" | "from" | "to" | "relation">[],
  edgeId: string,
): Reach {
  const start = edges.find((e) => e.id === edgeId);
  const reach: Reach = { nodes: new Set(), edges: new Set() };
  if (!start) return reach;
  reach.edges.add(start.id);
  reach.nodes.add(start.from);
  const out = new Map<string, Pick<DiagramEdge, "id" | "from" | "to" | "relation">[]>();
  // Messages never travel dependencies (config, secret...), so a path doesn't continue along them.
  for (const e of flowEdges(edges)) {
    const list = out.get(e.from);
    if (list) list.push(e);
    else out.set(e.from, [e]);
  }
  const queue = [start.to];
  while (queue.length) {
    const id = queue.shift()!;
    if (reach.nodes.has(id) && id !== start.from) continue;
    reach.nodes.add(id);
    for (const e of out.get(id) ?? []) {
      reach.edges.add(e.id);
      if (!reach.nodes.has(e.to)) queue.push(e.to);
    }
  }
  return reach;
}

/** Edges with both ends in `nodes` (kept bright while a note focuses on those nodes). */
export function edgesWithin(
  edges: readonly Pick<DiagramEdge, "id" | "from" | "to">[],
  nodes: ReadonlySet<string>,
): Set<string> {
  return new Set(edges.filter((e) => nodes.has(e.from) && nodes.has(e.to)).map((e) => e.id));
}
