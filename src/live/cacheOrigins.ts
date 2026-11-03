import type { DiagramFile } from "../model/types";

/** Build once per document: parallel connections must not rescan the edge list per incoming edge. */
export function cacheOriginIndex(diagram: DiagramFile) {
  const outgoing = new Map<string, number>();
  for (const edge of diagram.edges)
    if (edge.kind === "sync") outgoing.set(edge.from, (outgoing.get(edge.from) ?? 0) + 1);
  return { outgoing, labels: new Map(diagram.nodes.map((node) => [node.id, node.label])) };
}
