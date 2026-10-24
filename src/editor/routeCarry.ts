import type { DiagramFlowEdge } from "../canvas/types";
import type { Point } from "../canvas/geometry/rect";

/** Stationary or independently arranged ends keep their bends. */
export function sharedDelta(source: string, target: string, moved: ReadonlyMap<string, Point>): Point | undefined {
  const a = moved.get(source);
  const b = moved.get(target);
  return a && b && (a.x || a.y) && Math.abs(a.x - b.x) <= 0.5 && Math.abs(a.y - b.y) <= 0.5 ? a : undefined;
}

/** Preserve identities for untouched edges (and for a wholly unchanged list). */
export function carryWaypoints(edges: DiagramFlowEdge[], moved: ReadonlyMap<string, Point>): DiagramFlowEdge[] {
  let changed = false;
  const next = edges.map((e) => {
    const delta = e.data?.waypoints?.length && sharedDelta(e.source, e.target, moved);
    if (!delta) return e;
    changed = true;
    return {
      ...e,
      data: { ...e.data!, waypoints: e.data!.waypoints!.map((p) => ({ x: p.x + delta.x, y: p.y + delta.y })) },
    };
  });
  return changed ? next : edges;
}

/** Layout commands reset only lines incident to nodes whose positions changed. */
export function resetMovedWaypoints(edges: DiagramFlowEdge[], movedIds: ReadonlySet<string>): DiagramFlowEdge[] {
  let changed = false;
  const next = edges.map((e) => {
    if (!e.data?.waypoints?.length || (!movedIds.has(e.source) && !movedIds.has(e.target))) return e;
    changed = true;
    const data = { ...e.data };
    delete data.waypoints;
    return { ...e, data };
  });
  return changed ? next : edges;
}
