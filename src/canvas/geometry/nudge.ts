// Nudging: segments of different edges that would share a track (same line, overlapping spans) are
// spread apart so every line stays distinguishable. The first and last segment of a route are
// pinned to their ports; interior segments slide perpendicular to themselves, stretching their
// neighbours. Order within a track is chosen so that segments turn off without crossing each other.

import { inflate, segmentHitsRect, type Point, type Rect } from "./rect";
import { RectIndex, SpatialGrid } from "./spatial";

interface Seg {
  edge: string;
  k: number;
  vertical: boolean;
  /** Perpendicular coordinate (x for vertical segments). */
  c: number;
  lo: number;
  hi: number;
  pinned: boolean;
  /** Turn at the low / high end: -1 toward smaller perpendicular coordinate, +1 larger, 0 none. */
  loTurn: number;
  hiTurn: number;
}

export interface NudgeOptions {
  /** Distance between parallel segments in a shared track. */
  separation?: number;
  /** Segments closer than this count as sharing a track. */
  tolerance?: number;
}

function segmentsOf(edge: string, pts: Point[], vertical: boolean): Seg[] {
  const out: Seg[] = [];
  const n = pts.length - 1;
  for (let k = 0; k < n; k++) {
    const a = pts[k],
      b = pts[k + 1];
    const isV = Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) >= 0.5;
    const isH = Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) >= 0.5;
    if (vertical ? !isV : !isH) continue;
    const along = (p: Point) => (vertical ? p.y : p.x);
    const perp = (p: Point) => (vertical ? p.x : p.y);
    const loIsA = along(a) <= along(b);
    const turn = (endIdx: number, nbrIdx: number) => {
      if (nbrIdx < 0 || nbrIdx > n) return 0;
      const d = perp(pts[nbrIdx]) - perp(pts[endIdx]);
      return Math.abs(d) < 0.5 ? 0 : Math.sign(d);
    };
    const turnA = turn(k, k - 1);
    const turnB = turn(k + 1, k + 2);
    out.push({
      edge,
      k,
      vertical,
      c: perp(a),
      lo: Math.min(along(a), along(b)),
      hi: Math.max(along(a), along(b)),
      pinned: k === 0 || k === n - 1,
      loTurn: loIsA ? turnA : turnB,
      hiTurn: loIsA ? turnB : turnA,
    });
  }
  return out;
}

/** Positive when `a` should sit on the larger-coordinate side of `b`. */
function compare(a: Seg, b: Seg): number {
  let vote = 0;
  if (a.lo > b.lo + 1) vote += a.loTurn;
  else if (b.lo > a.lo + 1) vote -= b.loTurn;
  else vote += (a.loTurn - b.loTurn) / 2;
  if (a.hi < b.hi - 1) vote += a.hiTurn;
  else if (b.hi < a.hi - 1) vote -= b.hiTurn;
  else vote += (a.hiTurn - b.hiTurn) / 2;
  return vote;
}

function order(list: Seg[]): Seg[] {
  // Insertion sort: the comparator isn't guaranteed transitive, and bundles are small.
  const out = [...list].sort((a, b) => a.c - b.c || (a.edge < b.edge ? -1 : a.edge > b.edge ? 1 : a.k - b.k));
  for (let i = 1; i < out.length; i++) {
    let j = i;
    while (j > 0 && compare(out[j - 1], out[j]) > 0) {
      [out[j - 1], out[j]] = [out[j], out[j - 1]];
      j--;
    }
  }
  return out;
}

function clusters(segs: Seg[], tol: number): Seg[][] {
  const sorted = [...segs].sort((a, b) => a.c - b.c);
  const parent = sorted.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < sorted.length; i++)
    for (let j = i + 1; j < sorted.length && sorted[j].c - sorted[i].c < tol; j++) {
      const a = sorted[i],
        b = sorted[j];
      if (a.edge === b.edge) continue;
      if (Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) > 2) parent[find(i)] = find(j);
    }
  const groups = new Map<number, Seg[]>();
  sorted.forEach((s, i) => {
    const r = find(i);
    (groups.get(r) ?? groups.set(r, []).get(r)!).push(s);
  });
  return [...groups.values()].filter((g) => g.length > 1 && new Set(g.map((s) => s.edge)).size > 1);
}

/**
 * The obstacles, indexed so a moved segment or a bundle's room only reads the nodes near it, not the whole diagram's
 * (a drag frame nudges every route again). `near` returns a superset of the rects that box touches, never fewer: what
 * the index can't hold (non-finite or negative sizes) is always returned, so callers keep their exact tests.
 */
class Obstacles {
  private index: RectIndex;
  constructor(readonly all: readonly Rect[]) {
    this.index = new RectIndex(all);
  }
  near(box: Rect): Rect[] {
    return this.index.near(box).map((i) => this.all[i]);
  }
}

/** Slack added to every query box: far beyond float error, so an exact test's hit is always among the candidates. */
const QUERY_SLACK = 4;

function aroundPoints(pts: readonly Point[], pad: number): Rect {
  let x1 = Infinity,
    y1 = Infinity,
    x2 = -Infinity,
    y2 = -Infinity;
  for (const p of pts) {
    x1 = Math.min(x1, p.x);
    y1 = Math.min(y1, p.y);
    x2 = Math.max(x2, p.x);
    y2 = Math.max(y2, p.y);
  }
  return { x: x1 - pad, y: y1 - pad, width: x2 - x1 + 2 * pad, height: y2 - y1 + 2 * pad };
}

/** Moves segment k of `pts` to perpendicular coordinate `to`, clamped so neighbours keep their direction. */
function moveSegment(pts: Point[], k: number, vertical: boolean, to: number, obstacles: Obstacles): void {
  const key = vertical ? "x" : "y";
  const from = pts[k][key];
  let target = to;
  const n = pts.length - 1;
  // Neighbour k-1 runs pts[k-1] -> pts[k]; neighbour k+1 runs pts[k+1] -> pts[k+2].
  const limit = (fixed: Point, isStub: boolean) => {
    const min = isStub ? 12 : 3;
    const dir = Math.sign(from - fixed[key]);
    if (dir === 0) return;
    // Keep (target - fixed) * dir >= min.
    const bound = fixed[key] + dir * min;
    if (dir > 0 && target < bound) target = bound;
    if (dir < 0 && target > bound) target = bound;
  };
  if (k - 1 >= 0) limit(pts[k - 1], k - 1 === 0);
  if (k + 2 <= n) limit(pts[k + 2], k + 1 === n - 1);
  if (Math.abs(target - from) < 0.25) return;
  const a = { ...pts[k], [key]: target };
  const b = { ...pts[k + 1], [key]: target };
  // Don't push a line into a node. The stubs start on their node's border, so test the interior.
  const moved = [...(k > 0 ? [pts[k - 1]] : []), a, b, ...(k + 2 <= n ? [pts[k + 2]] : [])];
  for (const r of obstacles.near(aroundPoints(moved, 2 + QUERY_SLACK))) {
    if (
      segmentHitsRect(a, b, inflate(r, 2)) ||
      (k > 0 && segmentHitsRect(pts[k - 1], a, r, 1)) ||
      (k + 2 <= n && segmentHitsRect(b, pts[k + 2], r, 1))
    )
      return;
  }
  pts[k] = a;
  pts[k + 1] = b;
}

/**
 * Spreads overlapping collinear segments. `routes` maps edge id -> orthogonal polyline (mutated
 * copies are returned). `obstacles` are raw node rects (the endpoints' nodes included).
 */
export function nudgeRoutes(
  routes: ReadonlyMap<string, Point[]>,
  obstacleRects: readonly Rect[],
  opts: NudgeOptions = {},
): Map<string, Point[]> {
  const sep = opts.separation ?? 11;
  const tol = opts.tolerance ?? sep * 0.75;
  const obstacles = new Obstacles(obstacleRects);
  const out = new Map<string, Point[]>();
  for (const [id, pts] of routes)
    out.set(
      id,
      pts.map((p) => ({ ...p })),
    );

  const spread = () => {
    for (const vertical of [true, false]) {
      const segs: Seg[] = [];
      for (const [id, pts] of out) segs.push(...segmentsOf(id, pts, vertical));
      for (const group of clusters(segs, tol)) {
        const ordered = order(group);
        const n = ordered.length;
        const mean = ordered.reduce((s, g) => s + g.c, 0) / n;
        // Room on each side of the track over the bundle's span, so the spread never reaches a node.
        const lo = Math.min(...ordered.map((g) => g.lo));
        const hi = Math.max(...ordered.map((g) => g.hi));
        let below = Infinity,
          above = Infinity;
        // Only the room within `reach` of the track can narrow the step below `sep` (room = reach - 6 gives exactly
        // sep), so the obstacles beyond it are left unread: whatever they are, the step is the same.
        const reach = (sep * (n - 1)) / 2 + 6 + QUERY_SLACK;
        const window: Rect = vertical
          ? { x: mean - reach, y: lo - QUERY_SLACK, width: 2 * reach, height: hi - lo + 2 * QUERY_SLACK }
          : { x: lo - QUERY_SLACK, y: mean - reach, width: hi - lo + 2 * QUERY_SLACK, height: 2 * reach };
        for (const r of obstacles.near(window)) {
          const rLo = vertical ? r.y : r.x;
          const rHi = vertical ? r.y + r.height : r.x + r.width;
          if (rHi <= lo + 1 || rLo >= hi - 1) continue;
          const pLo = vertical ? r.x : r.y;
          const pHi = vertical ? r.x + r.width : r.y + r.height;
          if (pHi <= mean) below = Math.min(below, mean - pHi);
          else if (pLo >= mean) above = Math.min(above, pLo - mean);
        }
        const room = Math.min(below, above) - 6;
        const step = n > 1 ? Math.max(4, Math.min(sep, (2 * room) / (n - 1))) : sep;
        const slots = ordered.map((_, i) => mean + (i - (n - 1) / 2) * step);
        const pinnedIdx = ordered.findIndex((g) => g.pinned);
        const shift = pinnedIdx >= 0 ? ordered[pinnedIdx].c - slots[pinnedIdx] : 0;
        ordered.forEach((g, i) => {
          if (g.pinned) return;
          moveSegment(out.get(g.edge)!, g.k, vertical, slots[i] + shift, obstacles);
        });
      }
    }
  };
  spread();
  // Swapping bends can land a segment on someone else's track: spread once more.
  if (resolvePinnedOverlaps(out, obstacles, tol)) spread();
  return out;
}

/**
 * Two port stubs on the same line (an edge leaving a node and another entering the node across
 * the channel at the same height) can't move, so if they overlap, the bends next to them are in
 * the wrong order: swap those bends' positions so each stub ends before the other begins.
 */
function resolvePinnedOverlaps(out: Map<string, Point[]>, obstacles: Obstacles, tol: number): boolean {
  let swapped = false;
  for (const vertical of [false, true]) {
    const segs: Seg[] = [];
    for (const [id, pts] of out) segs.push(...segmentsOf(id, pts, vertical).filter((s) => s.pinned));
    const index = new SpatialGrid<number>();
    const box = (s: Seg): Rect =>
      vertical
        ? { x: s.c, y: s.lo, width: 0, height: s.hi - s.lo }
        : { x: s.lo, y: s.c, width: s.hi - s.lo, height: 0 };
    segs.forEach((s, i) => index.insert(box(s), i));
    for (let i = 0; i < segs.length; i++)
      // Keep the original pair order: bend swaps depend on earlier successful swaps.
      for (const j of index
        .query(inflate(box(segs[i]), tol))
        .map((e) => e.item)
        .filter((j) => j > i)
        .sort((a, b) => a - b)) {
        const a = segs[i],
          b = segs[j];
        if (a.edge === b.edge || Math.abs(a.c - b.c) >= tol || Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) <= 2)
          continue;
        const pa = out.get(a.edge)!,
          pb = out.get(b.edge)!;
        const na = a.k === 0 ? 1 : a.k - 1;
        const nb = b.k === 0 ? 1 : b.k - 1;
        const lastA = pa.length - 2,
          lastB = pb.length - 2;
        // The neighbours must be free interior segments.
        if (na <= 0 || na >= lastA || nb <= 0 || nb >= lastB) continue;
        const key = vertical ? "y" : "x";
        const ca = pa[na][key],
          cb = pb[nb][key];
        const beforeA = pa.map((p) => ({ ...p })),
          beforeB = pb.map((p) => ({ ...p }));
        moveSegment(pa, na, !vertical, cb, obstacles);
        moveSegment(pb, nb, !vertical, ca, obstacles);
        const sa = segmentsOf(a.edge, pa, vertical).find((s) => s.k === a.k);
        const sb = segmentsOf(b.edge, pb, vertical).find((s) => s.k === b.k);
        const still = !sa || !sb || Math.min(sa.hi, sb.hi) - Math.max(sa.lo, sb.lo) > 2;
        if (still) {
          out.set(a.edge, beforeA);
          out.set(b.edge, beforeB);
        } else swapped = true;
      }
  }
  return swapped;
}
