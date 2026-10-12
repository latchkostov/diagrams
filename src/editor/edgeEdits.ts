// Rewiring edges on the canvas (D8): move one end to another node, or split an edge around a node dropped
// onto it. Pure: they take the canvas's edges and return the next ones (or null when nothing changes).

import type { DiagramFlowEdge } from "../canvas/types";
import { uniqueId } from "./ids";

export type EdgeEnd = "source" | "target";

/**
 * Moves one end of `edgeId` onto `nodeId`, keeping everything else: its id, label, relationship, kind and
 * settings. The side pinned for that end belonged to the old node, so it goes (the other end keeps its own).
 * Null when the edge is missing, the end is already there, or the edge would join a node to itself.
 */
export function reconnectEdge(
  edges: readonly DiagramFlowEdge[],
  edgeId: string,
  end: EdgeEnd,
  nodeId: string,
): DiagramFlowEdge[] | null {
  const e = edges.find((x) => x.id === edgeId);
  if (!e) return null;
  const other = end === "source" ? e.target : e.source;
  if (e[end] === nodeId || other === nodeId) return null;
  const data = { kind: "async" as const, ...e.data };
  if (end === "source") delete data.sourceSide;
  else delete data.targetSide;
  const next: DiagramFlowEdge = { ...e, [end]: nodeId, data };
  return edges.map((x) => (x === e ? next : x));
}

/**
 * Puts `nodeId` in the middle of `edgeId`: A→B becomes A→N and N→B, like the AI's `insert_between`. The
 * first keeps the edge's id, label and source side; both keep its kind, relationship and settings (each its
 * own copy); the second takes the target side. Null when the edge is missing or already touches the node.
 */
export function splitEdge(
  edges: readonly DiagramFlowEdge[],
  edgeId: string,
  nodeId: string,
  taken: ReadonlySet<string> = new Set(edges.map((x) => x.id)),
): { edges: DiagramFlowEdge[]; first: string; second: string } | null {
  const e = edges.find((x) => x.id === edgeId);
  if (!e || e.source === nodeId || e.target === nodeId) return null;
  const d = { kind: "async" as const, ...e.data };
  const carried = {
    kind: d.kind,
    ...(d.relation ? { relation: d.relation } : {}),
  };
  const props = () => (d.props ? { props: structuredClone(d.props) } : {});
  const first: DiagramFlowEdge = {
    ...e,
    target: nodeId,
    selected: false,
    data: {
      ...carried,
      ...(d.label !== undefined ? { label: d.label } : {}),
      ...(d.sourceSide ? { sourceSide: d.sourceSide } : {}),
      ...props(),
    },
  };
  const secondId = uniqueId("e", new Set([...taken, ...edges.map((x) => x.id)]));
  const second: DiagramFlowEdge = {
    id: secondId,
    type: e.type ?? "flow",
    source: nodeId,
    target: e.target,
    data: { ...carried, ...(d.targetSide ? { targetSide: d.targetSide } : {}), ...props() },
  };
  const out: DiagramFlowEdge[] = [];
  for (const x of edges) {
    if (x !== e) out.push(x);
    else out.push(first, second);
  }
  return { edges: out, first: e.id, second: secondId };
}
