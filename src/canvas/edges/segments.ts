import { sideNormal, type Point, type Rect } from "../geometry/rect";
import { ROUTE_PAD } from "../geometry/router";
import type { Side } from "../../model/types";
import type { GuideLine } from "../guides";

export interface RouteSegment {
  k: number;
  axis: "h" | "v";
  a: Point;
  b: Point;
  end: boolean;
}

export function routeSegments(points: readonly Point[]): RouteSegment[] {
  return points.slice(1).flatMap((b, k) => {
    const a = points[k];
    return (a.x !== b.x && a.y !== b.y) || (a.x === b.x && a.y === b.y)
      ? []
      : [{ k, axis: a.y === b.y ? "h" : "v", a, b, end: k === 0 || k === points.length - 2 }];
  });
}

/** Copy the nudged corners as drawn, without touching the routing input. */
export const freezeRoute = (points: readonly Point[]): Point[] => points.slice(1, -1).map((p) => ({ ...p }));

/** Inset shape ports may need more than the usual 24 px to escape their owning box. */
export function portStub(point: Point, side: Side, rect?: Rect): number {
  if (!rect) return 24;
  const normal = sideNormal[side];
  const boundary = {
    x: side === "right" ? rect.x + rect.width : rect.x,
    y: side === "bottom" ? rect.y + rect.height : rect.y,
  };
  return Math.max(24, (boundary.x - point.x) * normal.x + (boundary.y - point.y) * normal.y + ROUTE_PAD);
}

/** Full preview polyline. The saved document receives only its inner corners, on drop. */
export function dragSegment(
  points: readonly Point[],
  k: number,
  to: number,
  stubs: readonly [number, number] = [24, 24],
): Point[] {
  if (k < 0 || k >= points.length - 1) return points.map((p) => ({ ...p }));
  if (k === points.length - 2 && k !== 0)
    return dragSegment([...points].reverse(), 0, to, [stubs[1], stubs[0]]).reverse();
  const out = points.map((p) => ({ ...p }));
  const a = out[k],
    b = out[k + 1];
  const horizontal = a.y === b.y;
  const cross = horizontal ? "y" : "x";
  const along = horizontal ? "x" : "y";
  if (to === a[cross]) return out;
  if (k > 0) {
    a[cross] = b[cross] = to;
    return out;
  }
  const stub = {
    ...a,
    [along]: a[along] + Math.sign(b[along] - a[along]) * stubs[0],
  };
  if (points.length === 2) {
    const tail = { ...b, [along]: b[along] - Math.sign(b[along] - a[along]) * stubs[1] };
    return [a, stub, { ...stub, [cross]: to }, { ...tail, [cross]: to }, tail, b];
  }
  return [a, stub, { ...stub, [cross]: to }, { ...b, [cross]: to }, ...out.slice(2)];
}

/** Collapse aligned neighbours and tiny jogs, preserving the endpoints of the supplied polyline. */
export function normalizeWaypoints(points: readonly Point[], tol = 4): Point[] {
  const out = points.map((p) => ({ ...p }));
  // Collapse a short inner leg by sliding the following segment onto its predecessor's line.
  // Move both corners together so tolerance never introduces a diagonal.
  for (let i = 1; i < out.length - 2; i++) {
    const a = out[i],
      b = out[i + 1],
      c = out[i + 2];
    const axis = a.x === b.x ? "y" : "x";
    if (Math.abs(a[axis] - b[axis]) <= tol && b[axis] === c[axis]) {
      b[axis] = c[axis] = a[axis];
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 1; i < out.length - 1; i++) {
      const a = out[i - 1],
        b = out[i],
        c = out[i + 1];
      if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) {
        out.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return out;
}

export interface SnapCandidates {
  ports: readonly number[];
  segments: readonly number[];
  nodes: readonly number[];
  from: number;
  to: number;
}

/** Priority is port, same-line segment, node edge/centre, then the grid. Threshold is in flow px. */
export function snapSegment(
  value: number,
  axis: "h" | "v",
  candidates: SnapCandidates,
  threshold: number,
): { value: number; guide?: GuideLine } {
  for (const values of [candidates.ports, candidates.segments, candidates.nodes]) {
    let best: number | undefined;
    for (const at of values)
      if (Math.abs(at - value) <= threshold && (best === undefined || Math.abs(at - value) < Math.abs(best - value)))
        best = at;
    if (best !== undefined)
      return {
        value: best,
        guide: { axis: axis === "h" ? "y" : "x", at: best, from: candidates.from, to: candidates.to },
      };
  }
  const grid = Math.round(value / 10) * 10;
  return { value: Math.abs(grid - value) <= threshold ? grid : value };
}
