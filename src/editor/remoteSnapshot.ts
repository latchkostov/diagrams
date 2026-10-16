import { structuralText } from "../model/diagramDiff";
import type { CanvasSnapshot } from "./useHistory";

/** Indexed once per projection, including large bulk selections. IDs are React Flow IDs. */
export function remoteTargetRemoved(
  current: CanvasSnapshot,
  next: CanvasSnapshot,
  focus: { inspector?: boolean; id?: string },
): boolean {
  const nodes = new Set(next.nodes.map((n) => n.id)),
    edges = new Set(next.edges.map((e) => e.id));
  if (focus.id) return !nodes.has(focus.id) && !edges.has(focus.id);
  return (
    !!focus.inspector &&
    (current.nodes.some((n) => n.selected && !nodes.has(n.id)) ||
      current.edges.some((e) => e.selected && !edges.has(e.id)))
  );
}

/** Keep local selection, measurements and unchanged record identities across a room projection. */
export function retainRemoteSelection(current: CanvasSnapshot, next: CanvasSnapshot): CanvasSnapshot {
  const nodes = new Map(current.nodes.map((n) => [n.id, n]));
  const edges = new Map(current.edges.map((e) => [e.id, e]));
  return {
    meta: structuralText(current.meta) === structuralText(next.meta) ? current.meta : next.meta,
    nodes: next.nodes.map((n) => {
      const old = nodes.get(n.id);
      if (!old) return n;
      if (
        old.type === n.type &&
        old.parentId === n.parentId &&
        old.width === n.width &&
        old.height === n.height &&
        structuralText(old.data) === structuralText(n.data) &&
        structuralText(old.position) === structuralText(n.position)
      )
        return old;
      return { ...n, selected: old.selected, measured: old.measured };
    }),
    edges: next.edges.map((e) => {
      const old = edges.get(e.id);
      if (!old) return e;
      const retained = { ...e, selected: old.selected };
      return structuralText(old) === structuralText(retained) ? old : retained;
    }),
  };
}
