import type { DiagramEdge } from "./types";

/**
 * Putting a node in the middle of a connection: A→B becomes A→N and N→B. One rule for every lane that does it
 * (the AI's `insert_between`, a node or stencil dropped on an edge, Insert node on an edge's menu): the
 * replaced connection's meaning carries over. Kind, relationship and settings go on both (each its own copy of
 * the settings); the label and the source's pinned side on the first, the target's pinned side on the second.
 * The caller picks the two ids (the canvas keeps the old id on the first half; the AI makes fresh ones).
 */
export function splitEdge(
  old: DiagramEdge,
  nodeId: string,
  ids: { first: string; second: string },
): [DiagramEdge, DiagramEdge] {
  const carried = {
    ...(old.kind ? { kind: old.kind } : {}),
    ...(old.relation ? { relation: old.relation } : {}),
    ...(old.relationOrigin ? { relationOrigin: old.relationOrigin } : {}),
  };
  const props = () => (old.props ? { props: structuredClone(old.props) } : {});
  return [
    {
      id: ids.first,
      from: old.from,
      to: nodeId,
      ...carried,
      ...(old.label !== undefined ? { label: old.label } : {}),
      ...(old.sourceSide ? { sourceSide: old.sourceSide } : {}),
      ...props(),
    },
    {
      id: ids.second,
      from: nodeId,
      to: old.to,
      ...carried,
      ...(old.targetSide ? { targetSide: old.targetSide } : {}),
      ...props(),
    },
  ];
}
