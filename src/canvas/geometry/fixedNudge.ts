import type { Point, Rect } from "./rect";
import { nudgeRoutes, type Seg } from "./nudge";

/** Saved-route constraints load with the geometry, keeping first-view routing unchanged. */
export function nudgeFixedRoutes(
  routes: ReadonlyMap<string, Point[]>,
  obstacles: readonly Rect[],
  options: { fixed: ReadonlySet<string> },
) {
  return nudgeRoutes(routes, obstacles, {
    ...options,
    index: trackCandidates,
    canMove: fixedNudgeGuard(routes, options.fixed),
  });
}

interface Segment {
  vertical: boolean;
  c: number;
  lo: number;
  hi: number;
}
function segment(a: Point, b: Point): Segment {
  const vertical = Math.abs(a.x - b.x) < 0.5;
  return {
    vertical,
    c: vertical ? a.x : a.y,
    lo: Math.min(vertical ? a.y : a.x, vertical ? b.y : b.x),
    hi: Math.max(vertical ? a.y : a.x, vertical ? b.y : b.x),
  };
}
const overlap = (a: Segment, b: Segment) =>
  a.vertical === b.vertical && Math.abs(a.c - b.c) < 0.5 ? Math.max(0, Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo)) : 0;

interface IntervalNode<T> {
  segment: T;
  high: number;
  left?: IntervalNode<T>;
  right?: IntervalNode<T>;
}

/** A balanced tree retains a separate maximum end for every subtree, not every prefix. */
function intervalTree<T extends Segment>(sorted: T[], lo = 0, hi = sorted.length): IntervalNode<T> | undefined {
  if (lo === hi) return;
  const mid = (lo + hi) >>> 1;
  const left = intervalTree(sorted, lo, mid);
  const right = intervalTree(sorted, mid + 1, hi);
  return {
    segment: sorted[mid],
    high: Math.max(sorted[mid].hi, left?.high ?? -Infinity, right?.high ?? -Infinity),
    left,
    right,
  };
}

/** Track and interval bounds stay selective when a segment is too long for a spatial grid. */
class TrackIndex<T extends Segment> {
  private tracks: { c: number; root: IntervalNode<T> | undefined }[];
  constructor(segments: T[]) {
    const groups = new Map<number, T[]>();
    for (const s of segments) {
      const list = groups.get(s.c) ?? [];
      list.push(s);
      groups.set(s.c, list);
    }
    this.tracks = [...groups]
      .sort(([a], [b]) => a - b)
      .map(([c, list]) => {
        list.sort((a, b) => a.lo - b.lo);
        return { c, root: intervalTree(list) };
      });
  }
  near(s: Segment, tolerance: number): T[] {
    const hits: T[] = [];
    const list = this.tracks;
    let lo = 0,
      hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (list[mid].c < s.c - tolerance) lo = mid + 1;
      else hi = mid;
    }
    const visit = (node: IntervalNode<T> | undefined) => {
      if (!node || node.high <= s.lo + 2) return;
      visit(node.left);
      const candidate = node.segment;
      if (candidate.lo >= s.hi - 2) return;
      if (Math.min(s.hi, candidate.hi) - Math.max(s.lo, candidate.lo) > 2) hits.push(candidate);
      visit(node.right);
    };
    for (let i = lo; i < list.length && list[i].c <= s.c + tolerance; i++) visit(list[i].root);
    return hits;
  }
}

export function trackCandidates(segments: Seg[]) {
  const index = new TrackIndex(segments.map((s, item) => ({ ...s, item })));
  return index.near.bind(index);
}

/** Fixed segments indexed by track. Binary track queries do not scan distant or very long saved segments. */
export function fixedNudgeGuard(routes: ReadonlyMap<string, Point[]>, fixed: ReadonlySet<string>) {
  if (!fixed.size || fixed.size === routes.size) return;
  const segments: Segment[][] = [[], []];
  for (const id of fixed) {
    const pts = routes.get(id) ?? [];
    for (let k = 1; k < pts.length; k++) {
      const s = segment(pts[k - 1], pts[k]);
      if (s.vertical || Math.abs(pts[k - 1].y - pts[k].y) < 0.5) {
        segments[Number(s.vertical)].push(s);
      }
    }
  }
  const tracks = segments.map((axis) => new TrackIndex(axis));
  return (before: Point[], movedSegment: number, after: Point[]): boolean => {
    const offset = Math.max(0, movedSegment - 1);
    for (let k = 1; k < after.length; k++) {
      const s = segment(after[k - 1], after[k]);
      const old = segment(before[offset + k - 1], before[offset + k]);
      for (const fixed of tracks[Number(s.vertical)].near(s, 0.5)) {
        const length = overlap(s, fixed);
        if (length > 2 && length > overlap(old, fixed)) return false;
      }
    }
    return true;
  };
}
