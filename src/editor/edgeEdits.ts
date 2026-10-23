// Rewiring edges on the canvas (D8): move one end to another node, or split an edge around a node dropped
// onto it. Pure: they take the canvas's edges and return the next ones (or null when nothing changes).

import type { Side } from "../model/types";
import type { DiagramFlowEdge } from "../canvas/types";
import { edgeFromFlow, edgeToFlow } from "../canvas/convert";
import { splitEdge } from "../model/edgeSplit";
import { uniqueId } from "./ids";

export type EdgeEnd = "source" | "target";

/**
 * Moves one end of `edgeId` onto `nodeId`, keeping everything else: its id, label, relationship, kind and
 * settings. A dot fixes that end's side; a body drop on another node clears it. The other end keeps its side.
 * Null when the edge is missing, the attachment is unchanged, or the edge would join a node to itself.
 */
export function reconnectEdge(
  edges: readonly DiagramFlowEdge[],
  edgeId: string,
  end: EdgeEnd,
  nodeId: string,
  side?: Side,
): DiagramFlowEdge[] | null {
  const e = edges.find((x) => x.id === edgeId);
  if (!e) return null;
  const other = end === "source" ? e.target : e.source;
  const key = end === "source" ? "sourceSide" : "targetSide";
  if (other === nodeId || (e[end] === nodeId && (!side || e.data?.[key] === side))) return null;
  const data = { kind: "async" as const, ...e.data };
  if (side) data[key] = side;
  else if (end === "source") delete data.sourceSide;
  else delete data.targetSide;
  const next: DiagramFlowEdge = { ...e, [end]: nodeId, data };
  return edges.map((x) => (x === e ? next : x));
}

/**
 * Puts `nodeId` in the middle of `edgeId` on the canvas: A→B becomes A→N and N→B with the model's one split
 * rule (src/model/edgeSplit.ts, shared with the AI's `insert_between`). The first half keeps the edge's id.
 * Null when the edge is missing or already touches the node.
 */
export function splitFlowEdge(
  edges: readonly DiagramFlowEdge[],
  edgeId: string,
  nodeId: string,
  taken: ReadonlySet<string> = new Set(edges.map((x) => x.id)),
  allocate: typeof uniqueId = uniqueId,
): { edges: DiagramFlowEdge[]; first: string; second: string } | null {
  const e = edges.find((x) => x.id === edgeId);
  if (!e || e.source === nodeId || e.target === nodeId) return null;
  const second = allocate("e", new Set([...taken, ...edges.map((x) => x.id)]));
  const [a, b] = splitEdge(edgeFromFlow(e), nodeId, { first: e.id, second }).map(edgeToFlow);
  const out: DiagramFlowEdge[] = [];
  for (const x of edges) {
    if (x !== e) out.push(x);
    else out.push(a, b);
  }
  return { edges: out, first: e.id, second };
}

/** Each end decides: an omitted side in a pointer attachment means automatic on that end. */
export function setEdgeSides(edge: DiagramFlowEdge, sides: { sourceSide?: Side; targetSide?: Side }): DiagramFlowEdge {
  const data = { kind: "async" as const, ...edge.data };
  if (sides.sourceSide) data.sourceSide = sides.sourceSide;
  else delete data.sourceSide;
  if (sides.targetSide) data.targetSide = sides.targetSide;
  else delete data.targetSide;
  return { ...edge, data };
}
