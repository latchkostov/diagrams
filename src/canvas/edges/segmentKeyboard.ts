import type { EdgeRoute } from "../geometry/router";
import type { RouteSegment } from "./segments";
import { dragSegment, normalizeWaypoints, routeSegments } from "./segments";
import { nudgeOnGrid } from "../guides";

/** Prefer the label's segment, then the longest inner leg, then an end. */
export function startSegment(
  segments: readonly RouteSegment[],
  label: Pick<NonNullable<EdgeRoute["label"]>, "x" | "y"> | null,
): number {
  const length = (s: RouteSegment) => Math.abs(s.b.x - s.a.x) + Math.abs(s.b.y - s.a.y);
  const under =
    label &&
    segments.find(
      (s) =>
        label.x >= Math.min(s.a.x, s.b.x) - 1 &&
        label.x <= Math.max(s.a.x, s.b.x) + 1 &&
        label.y >= Math.min(s.a.y, s.b.y) - 1 &&
        label.y <= Math.max(s.a.y, s.b.y) + 1,
    );
  if (under) return segments.indexOf(under);
  const inner = segments.filter((s) => !s.end);
  const candidates = inner.length ? inner : segments;
  const best = candidates.reduce<RouteSegment | undefined>((a, b) => (!a || length(b) > length(a) ? b : a), undefined);
  return best ? segments.indexOf(best) : 0;
}

/** Follow a leg through merges and endpoint joins, distinguishing disjoint legs on the same line. */
export function followSegment(segments: readonly RouteSegment[], leg: Pick<RouteSegment, "axis" | "a" | "b">): number {
  const cross = leg.axis === "h" ? "y" : "x";
  const along = leg.axis === "h" ? "x" : "y";
  const lo = Math.min(leg.a[along], leg.b[along]);
  const hi = Math.max(leg.a[along], leg.b[along]);
  let best = -1,
    distance = Infinity,
    overlap = -Infinity;
  segments.forEach((s, index) => {
    if (s.axis !== leg.axis) return;
    const shared = Math.min(hi, Math.max(s.a[along], s.b[along])) - Math.max(lo, Math.min(s.a[along], s.b[along]));
    const gap = Math.max(0, -shared);
    const d = (s.a[cross] - leg.a[cross]) ** 2 + gap ** 2;
    if (d < distance || (d === distance && shared > overlap)) {
      best = index;
      distance = d;
      overlap = shared;
    }
  });
  return best < 0 ? startSegment(segments, null) : best;
}

/** Uses the same directional grid rule as node nudges. Re-select the moved leg after jogs/merges. */
export function nudgeSegment(
  points: EdgeRoute["points"],
  segment: RouteSegment,
  sign: 1 | -1,
  far: boolean,
  snap: boolean,
  stubs: readonly [number, number],
) {
  const cross = segment.axis === "h" ? "y" : "x";
  const before = segment.a[cross];
  const step = snap ? (far ? 50 : 10) : far ? 10 : 1;
  const to = before + (snap ? nudgeOnGrid(before, sign, 10, far ? 50 : null) : sign * step);
  // Every keyboard step is deliberate: a 1 px nudge or an off-grid hop must survive pointer merge tolerance.
  const normalized = normalizeWaypoints(dragSegment(points, segment.k, to, stubs), 0);
  const segments = routeSegments(normalized);
  const moved = followSegment(segments, {
    ...segment,
    a: { ...segment.a, [cross]: to },
    b: { ...segment.b, [cross]: to },
  });
  return {
    points: normalized,
    index: moved,
    distance: Math.abs(to - before),
  };
}
