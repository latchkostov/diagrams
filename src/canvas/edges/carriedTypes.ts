import { messageTypesAt } from "../../model/messageTypes";
import type { DiagramFlowEdge, DiagramFlowNode } from "../types";

const cache = new WeakMap<readonly object[], WeakMap<readonly object[], ReadonlyMap<string, string>>>();

/** One propagation per canvas snapshot, shared by every edge's selector; return stable primitive text. */
export function carriedTypes(
  nodes: readonly DiagramFlowNode[],
  edges: readonly DiagramFlowEdge[],
): ReadonlyMap<string, string> {
  let byEdges = cache.get(nodes);
  if (!byEdges) {
    byEdges = new WeakMap();
    cache.set(nodes, byEdges);
  }
  const previous = byEdges.get(edges);
  if (previous) return previous;
  const types = messageTypesAt({
    format: "diagrams/v1",
    title: "",
    nodes: nodes.filter((n) => n.type === "diagram").map((n) => ({ id: n.id, x: 0, y: 0, ...n.data })),
    edges: edges.map((e) => ({ id: e.id, from: e.source, to: e.target, ...e.data })),
  });
  const result = new Map([...types.carried].map(([id, list]) => [id, [...list].join(", ")]));
  byEdges.set(edges, result);
  return result;
}
