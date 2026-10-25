import { facingSide } from "../edges/routing";
export { fixedNudgeGuard, nudgeFixedRoutes as nudgeRoutes } from "./fixedNudge";
import type { RouteEdge } from "./router";
// Saved inner corners are fixed; only the end legs re-join the current ports.
import type { Side } from "../../model/types";
import type { RoutedPort } from "./ports";
import { isHorizontalSide, sideNormal, simplify, type Point, type Rect } from "./rect";

/** Interpret diagonals in a canonical traversal so reversal preserves the geometric path. */
export function orthogonalize(points: readonly Point[]): Point[] {
  let palindrome = true;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[points.length - 1 - i];
    const order = a.x - b.x || a.y - b.y;
    if (order > 0) return orthogonalize([...points].reverse()).reverse();
    if (order < 0) {
      palindrome = false;
      break;
    }
  }
  if (palindrome && points.length > 1) {
    const half = orthogonalize(points.slice(0, Math.ceil(points.length / 2)));
    return [
      ...half,
      ...half
        .slice(0, -1)
        .reverse()
        .map((p) => ({ ...p })),
    ];
  }
  const out: Point[] = [];
  for (const point of points) {
    const p = { ...point };
    const a = out.at(-1);
    if (a && a.x === p.x && a.y === p.y) continue;
    if (a && a.x !== p.x && a.y !== p.y) {
      const prev = out.at(-2);
      const horizontal = prev ? prev.y !== a.y : true;
      out.push(horizontal ? { x: p.x, y: a.y } : { x: a.x, y: p.y });
    }
    out.push(p);
  }
  return out;
}

function slide(w: Point[], side: Side, port: RoutedPort): void {
  if (w.length < 2) return;
  const [a, b] = w;
  if (isHorizontalSide(side) ? a.x === b.x : a.y === b.y) {
    if (isHorizontalSide(side)) a.y = port.escape.y;
    else a.x = port.escape.x;
  }
}

/** The same outward join is used at both ends (the tail is reversed). */
function join(port: RoutedPort, side: Side, w: Point, rect: Rect): Point[] {
  const e = port.escape;
  const normal = sideNormal[side];
  const horizontal = isHorizontalSide(side);
  if ((w.x - e.x) * normal.x + (w.y - e.y) * normal.y < 0) {
    // Go around the nearer edge of the owning box, with a deterministic low-coordinate tie.
    const low = horizontal ? rect.y - 16 : rect.x - 16;
    const high = horizontal ? rect.y + rect.height + 16 : rect.x + rect.width + 16;
    const a = horizontal ? e.y : e.x;
    const b = horizontal ? w.y : w.x;
    const at = Math.abs(a - low) + Math.abs(b - low) <= Math.abs(a - high) + Math.abs(b - high) ? low : high;
    return horizontal ? [e, { x: e.x, y: at }, { x: w.x, y: at }] : [e, { x: at, y: e.y }, { x: at, y: w.y }];
  }
  return [e, horizontal ? { x: w.x, y: e.y } : { x: e.x, y: w.y }];
}

export function shapedRoute(
  source: RoutedPort,
  sourceSide: Side,
  target: RoutedPort,
  targetSide: Side,
  waypoints: readonly Point[],
  sourceRect: Rect,
  targetRect: Rect,
): Point[] {
  const w = orthogonalize(waypoints);
  if (!w.length) return [];
  slide(w, sourceSide, source);
  w.reverse();
  slide(w, targetSide, target);
  w.reverse();
  return simplify(
    [
      source.attachment,
      ...join(source, sourceSide, w[0], sourceRect),
      ...w,
      ...join(target, targetSide, w[w.length - 1], targetRect).reverse(),
      target.attachment,
    ],
    1e-9,
  );
}

/** Keep saved-route argument assembly with its deferred geometry. */
export function routeFor(
  e: RouteEdge,
  source: RoutedPort,
  target: RoutedPort,
  sides: { sourceSide: Side; targetSide: Side },
  rects: ReadonlyMap<string, Rect>,
) {
  return shapedRoute(
    source,
    sides.sourceSide,
    target,
    sides.targetSide,
    e.waypoints!,
    rects.get(e.source)!,
    rects.get(e.target)!,
  );
}

export function sides(e: RouteEdge, s: Rect, t: Rect) {
  return {
    sourceSide: e.sourceSide ?? facingSide(s, e.waypoints![0]),
    targetSide: e.targetSide ?? facingSide(t, e.waypoints!.at(-1)!),
  };
}
