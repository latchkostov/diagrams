// What Undo and Redo select (docs/UX-PRINCIPLES.md, "Undo and the selection"). History keeps documents, not
// selections: Undo selects what the undone step changed, as it was before the step; Redo what it changed, as
// it is after. When all of that was part of the selection the step was made with, that whole selection comes
// back (an align leaves one node put). When the step only made things (Undo) or only removed them (Redo),
// there's nothing of it left to select, so the current selection stays where it still exists; Undo falls back
// to the selection the step was made with. Pure functions, so the rule is tested without a canvas.
import { fromFlow } from "../canvas/convert";
import { GROUP_PREFIX, type DiagramFlowEdge, type FlowNode } from "../canvas/types";
import { structuralText } from "../model/diagramDiff";
import type { DiagramFile, DiagramGroup, DiagramNode } from "../model/types";
import { canRedo, canUndo, present, redo, undo, type History } from "./history";
import type { CanvasSnapshot } from "./useHistory";

/** Selected React Flow ids: nodes (diagram nodes, annotations, `group:` boundaries) and edges. */
export interface FlowSelection {
  nodes: string[];
  edges: string[];
}

/** Undo history of the canvas: each step starts from the selection held just before it. */
export type CanvasHistory = History<CanvasSnapshot, FlowSelection>;

/** What counts as a change: the saved file (positions rounded, selection ignored). */
export const snapshotKey = (s: CanvasSnapshot) => JSON.stringify(fromFlow(s.meta, s.nodes, s.edges));

export const selectionOf = (s: Pick<CanvasSnapshot, "nodes" | "edges">): FlowSelection => ({
  nodes: s.nodes.filter((n) => n.selected).map((n) => n.id),
  edges: s.edges.filter((e) => e.selected).map((e) => e.id),
});

/** `s` with exactly `sel` selected. Untouched nodes and edges keep their identity. */
export function withSelection(s: CanvasSnapshot, sel: FlowSelection): CanvasSnapshot {
  const nodes = new Set(sel.nodes),
    edges = new Set(sel.edges);
  return {
    ...s,
    nodes: s.nodes.map((n) =>
      !!n.selected === nodes.has(n.id) ? n : ({ ...n, selected: nodes.has(n.id) } as FlowNode),
    ),
    edges: s.edges.map((e) =>
      !!e.selected === edges.has(e.id) ? e : ({ ...e, selected: edges.has(e.id) } as DiagramFlowEdge),
    ),
  };
}

const isEmpty = (sel: FlowSelection) => !sel.nodes.length && !sel.edges.length;

/** The part of `sel` that exists in `s`. */
function within(sel: FlowSelection, s: CanvasSnapshot): FlowSelection {
  const nodes = new Set(s.nodes.map((n) => n.id)),
    edges = new Set(s.edges.map((e) => e.id));
  return { nodes: sel.nodes.filter((id) => nodes.has(id)), edges: sel.edges.filter((id) => edges.has(id)) };
}

const byId = <T extends { id: string }>(xs: readonly T[] | undefined) => new Map((xs ?? []).map((x) => [x.id, x]));

const contains = (outer: DiagramGroup, inner: DiagramGroup) =>
  outer.x <= inner.x &&
  outer.y <= inner.y &&
  outer.x + outer.width >= inner.x + inner.width &&
  outer.y + outer.height >= inner.y + inner.height;

/**
 * What the step from `a` to `b` changed, by React Flow id: in `a` (what it changed or removed) and in `b`
 * (what it changed or added). Knock-on effects don't count, so they don't crowd the selection: a boundary
 * that only grew to hold members the step added or moved (Tidy up, a drop, a quick-add inside it), members that
 * only moved with their boundary (dragging it), and a node's membership of a boundary the step added or removed
 * (Ungroup, Group into boundary).
 */
export function stepChanges(a: DiagramFile, b: DiagramFile): { before: FlowSelection; after: FlowSelection } {
  const before: FlowSelection = { nodes: [], edges: [] },
    after: FlowSelection = { nodes: [], edges: [] };
  const groupsA = byId(a.groups),
    groupsB = byId(b.groups);
  const nodesA = byId(a.nodes),
    nodesB = byId(b.nodes);
  const lasting = (g: string | undefined) => g === undefined || (groupsA.has(g) && groupsB.has(g));
  const nodeText = (n: DiagramNode) => structuralText(lasting(n.group) ? n : { ...n, group: undefined });
  /** Moved only by as much as its boundary did (positions are rounded apart, so give or take a pixel). */
  const carried = (id: string) => {
    const na = nodesA.get(id),
      nb = nodesB.get(id);
    const ga = na?.group === nb?.group && na?.group ? groupsA.get(na.group) : undefined,
      gb = ga && groupsB.get(ga.id);
    if (!na || !nb || !ga || !gb || (ga.x === gb.x && ga.y === gb.y)) return false;
    const near = (u: number, v: number) => Math.abs(u - v) <= 1;
    return (
      near(nb.x - na.x, gb.x - ga.x) &&
      near(nb.y - na.y, gb.y - ga.y) &&
      nodeText({ ...na, x: 0, y: 0 }) === nodeText({ ...nb, x: 0, y: 0 })
    );
  };
  /** Boundaries with a member the step added or moved. */
  const pushed = new Set<string>();
  for (const n of b.nodes) {
    const old = nodesA.get(n.id);
    if (n.group && (!old || old.x !== n.x || old.y !== n.y)) pushed.add(n.group);
  }
  const grewOnly = (id: string) => {
    const ga = groupsA.get(id),
      gb = groupsB.get(id);
    return !!ga && !!gb && pushed.has(id) && ga.label === gb.label && ga.tone === gb.tone && contains(gb, ga);
  };

  const diff = <T extends { id: string }>(
    xs: readonly T[] | undefined,
    ys: readonly T[] | undefined,
    into: "nodes" | "edges",
    text: (x: T) => string,
    flowId: (id: string) => string = (id) => id,
    ignore: (id: string) => boolean = () => false,
  ) => {
    const old = byId(xs),
      next = byId(ys);
    for (const [id, x] of old) {
      const y = next.get(id);
      if (y && (ignore(id) || text(x) === text(y))) continue;
      before[into].push(flowId(id));
      if (y) after[into].push(flowId(id));
    }
    for (const id of next.keys()) if (!old.has(id)) after[into].push(flowId(id));
  };
  diff(a.groups, b.groups, "nodes", structuralText, (id) => GROUP_PREFIX + id, grewOnly);
  diff(a.nodes, b.nodes, "nodes", nodeText, undefined, carried);
  diff(a.annotations, b.annotations, "nodes", structuralText);
  diff(a.edges, b.edges, "edges", structuralText);
  return { before, after };
}

const fileOf = (s: CanvasSnapshot) => fromFlow(s.meta, s.nodes, s.edges);

/**
 * `changed` (not empty), or the whole selection the step was made with (`start`) when everything it changed is
 * part of that: an align or a Tidy up leaves a node where it was, and it comes back selected with the rest.
 */
function widened(changed: FlowSelection, start: FlowSelection | undefined, s: CanvasSnapshot): FlowSelection {
  if (!start) return changed;
  const nodes = new Set(start.nodes),
    edges = new Set(start.edges);
  const inside = changed.nodes.every((id) => nodes.has(id)) && changed.edges.every((id) => edges.has(id));
  return inside ? within(start, s) : changed;
}

/**
 * The selection after undoing the step from `before` to `after`, made with `start` selected: what it changed,
 * as it was (widened to `start`, above); else the current selection where it still exists; else `start`, where
 * it exists.
 */
export function selectionAfterUndo(
  after: CanvasSnapshot,
  before: CanvasSnapshot,
  current: FlowSelection,
  start?: FlowSelection,
): FlowSelection {
  const changed = stepChanges(fileOf(before), fileOf(after)).before;
  if (!isEmpty(changed)) return widened(changed, start, before);
  const kept = within(current, before);
  return isEmpty(kept) && start ? within(start, before) : kept;
}

/**
 * The selection after redoing the step from `before` to `after`, made with `start` selected: what it changed,
 * as it is now (widened to `start`), else the current selection where it still exists.
 */
export function selectionAfterRedo(
  before: CanvasSnapshot,
  after: CanvasSnapshot,
  current: FlowSelection,
  start?: FlowSelection,
): FlowSelection {
  const changed = stepChanges(fileOf(before), fileOf(after)).after;
  return isEmpty(changed) ? within(current, after) : widened(changed, start, after);
}

/**
 * Undo or Redo one step: the new history and the snapshot to show, with the selection above (`current` is
 * the selection on the canvas now). Null when there's no step that way.
 */
export function stepWithSelection(
  h: CanvasHistory,
  direction: "undo" | "redo",
  current: FlowSelection,
): { history: CanvasHistory; snapshot: CanvasSnapshot } | null {
  if (direction === "undo" ? !canUndo(h) : !canRedo(h)) return null;
  const from = present(h);
  const history = direction === "undo" ? undo(h) : redo(h);
  const to = present(history);
  const sel =
    direction === "undo"
      ? selectionAfterUndo(from.value, to.value, current, from.start)
      : selectionAfterRedo(from.value, to.value, current, to.start);
  return { history, snapshot: withSelection(to.value, sel) };
}
