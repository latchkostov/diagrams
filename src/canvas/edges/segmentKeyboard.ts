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

/** Uses the node grid rule; only an unchanged segment structure retains selection. */
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
  const previous = routeSegments(points);
  const unchanged =
    segments.length === previous.length &&
    segments.every((s, i) => s.k === previous[i].k && s.axis === previous[i].axis && s.end === previous[i].end);
  return {
    points: normalized,
    index: unchanged ? previous.findIndex((s) => s.k === segment.k) : -1,
    distance: Math.abs(to - before),
  };
}
