import type { DiagramEdge, DiagramFile, DiagramNode } from "./types";
import { messageTypesAt, type MessageTypes } from "./messageTypes";

/**
 * Message semantics read only these fields. The editor replaces an element (and its props) on every edit and never
 * mutates one, so a snapshot compares references and short strings: no serialization, no allocation on a hit.
 * Moving, measuring or selecting elements reuses the result; renaming a source's label, editing props, a connection
 * or the saved simulations does not.
 */
const sameNode = (a: DiagramNode, b: DiagramNode) =>
  a === b || (a.id === b.id && a.stencil === b.stencil && a.label === b.label && a.props === b.props);
const sameEdge = (a: DiagramEdge, b: DiagramEdge) =>
  a === b ||
  (a.id === b.id &&
    a.from === b.from &&
    a.to === b.to &&
    a.kind === b.kind &&
    a.relation === b.relation &&
    a.props === b.props);

export function sameElements<T>(a: readonly T[], b: readonly T[], same: (x: T, y: T) => boolean): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!same(a[i], b[i])) return false;
  return true;
}

interface Snapshot {
  /** Copies: a caller that pushes to its own array later can't make an old snapshot look current. */
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  planning: DiagramFile["planning"];
  simulations: DiagramFile["simulations"];
  result: MessageTypes;
}
const snapshots: Snapshot[] = [];

/** The same propagation while the routing content is unchanged. Shared by inspector and hover readers. */
export function cachedMessageTypesAt(diagram: DiagramFile): MessageTypes {
  for (const snapshot of snapshots)
    if (
      snapshot.planning === diagram.planning &&
      snapshot.simulations === diagram.simulations &&
      sameElements(snapshot.nodes, diagram.nodes, sameNode) &&
      sameElements(snapshot.edges, diagram.edges, sameEdge)
    )
      return snapshot.result;
  const result = messageTypesAt(diagram);
  // A few recent semantic snapshots cover undo and several simultaneous canvases without retaining a history.
  snapshots.unshift({
    nodes: [...diagram.nodes],
    edges: [...diagram.edges],
    planning: diagram.planning,
    simulations: diagram.simulations,
    result,
  });
  if (snapshots.length > 4) snapshots.pop();
  return result;
}
