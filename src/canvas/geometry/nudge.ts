// Nudging: segments of different edges that would share a track (same line, overlapping spans) are
// spread apart so every line stays distinguishable. The first and last segment of a route are
// pinned to their ports; interior segments slide perpendicular to themselves, stretching their
// neighbours. Order within a track is chosen so that segments turn off without crossing each other.

import { inflate, segmentHitsRect, union, type Point, type Rect } from "./rect";
import { RectIndex } from "./spatial";
import { clusterSegments, segmentBox, segmentIndex, type CandidateIndex } from "./nudgeClusters";

export interface Seg {
  edge: string;
  k: number;
  vertical: boolean;
  /** Perpendicular coordinate (x for vertical segments). */
  c: number;
  lo: number;
  hi: number;
  pinned: boolean;
  fixed: boolean;
  /** Turn at the low / high end: -1 toward smaller perpendicular coordinate, +1 larger, 0 none. */
  loTurn: number;
  hiTurn: number;
}

export interface NudgeOptions {
  /** Distance between parallel segments in a shared track. */
  separation?: number;
  /** Every segment of these hand-shaped edges stays put. */
  fixed?: ReadonlySet<string>;
  /** Lazy saved-route geometry can reject newly occupied fixed tracks. */
  canMove?: (before: Point[], segment: number, after: Point[]) => boolean;
  /** Saved geometry supplies a track index that also handles very long segments. */
  index?: CandidateIndex;
  /** Segments closer than this count as sharing a track. */
  tolerance?: number;
}

function segmentsOf(edge: string, pts: Point[], vertical: boolean, fixed = false): Seg[] {
  const out: Seg[] = [];
  const n = pts.length - 1;
  const along = vertical ? "y" : "x";
  const perp = vertical ? "x" : "y";
  const turn = (endIdx: number, nbrIdx: number) => {
    if (nbrIdx < 0 || nbrIdx > n) return 0;
    const d = pts[nbrIdx][perp] - pts[endIdx][perp];
    return Math.abs(d) < 0.5 ? 0 : Math.sign(d);
  };
  for (let k = 0; k < n; k++) {
    const a = pts[k],
      b = pts[k + 1];
    if (!(Math.abs(a[perp] - b[perp]) < 0.5 && Math.abs(a[along] - b[along]) >= 0.5)) continue;
    const loIsA = a[along] <= b[along];
    const turnA = turn(k, k - 1);
    const turnB = turn(k + 1, k + 2);
    out.push({
      edge,
      k,
      vertical,
      c: a[perp],
      lo: Math.min(a[along], b[along]),
      hi: Math.max(a[along], b[along]),
      pinned: fixed || k === 0 || k === n - 1,
      fixed,
      loTurn: loIsA ? turnA : turnB,
      hiTurn: loIsA ? turnB : turnA,
    });
  }
  return out;
}

const turnVote = (a: number, b: number, aTurn: number, bTurn: number) =>
  a > b + 1 ? aTurn : b > a + 1 ? -bTurn : (aTurn - bTurn) / 2;

/** Positive when `a` should sit on the larger-coordinate side of `b`. */
function compare(a: Seg, b: Seg): number {
  return turnVote(a.lo, b.lo, a.loTurn, b.loTurn) + turnVote(-a.hi, -b.hi, a.hiTurn, b.hiTurn);
}

function order(list: Seg[]): Seg[] {
  // Insertion sort: the comparator isn't guaranteed transitive, and bundles are small.
  const out = list.sort((a, b) => a.c - b.c || (a.edge < b.edge ? -1 : a.edge > b.edge ? 1 : a.k - b.k));
  for (let i = 1; i < out.length; i++) {
    let j = i;
    while (j > 0 && !(out[j - 1].fixed && out[j].fixed) && compare(out[j - 1], out[j]) > 0) {
      [out[j - 1], out[j]] = [out[j], out[j - 1]];
      j--;
    }
  }
  return out;
}

/**
 * The obstacles, indexed so a moved segment or a bundle's room only reads the nodes near it, not the whole diagram's
 * (a drag frame nudges every route again). `near` returns a superset of the rects that box touches, never fewer: what
 * the index can't hold (non-finite or negative sizes) is always returned, so callers keep their exact tests.
 */
type Obstacles = RectIndex & Pick<NudgeOptions, "canMove">;

/** Slack added to every query box: far beyond float error, so an exact test's hit is always among the candidates. */
const QUERY_SLACK = 4;

/** Moves a free interior segment k; both callers exclude pinned first/last segments. */
function moveSegment(pts: Point[], k: number, vertical: boolean, to: number, obstacles: Obstacles): void {
  const key = vertical ? "x" : "y";
  const from = pts[k][key];
  let target = to;
  // Neighbour k-1 runs pts[k-1] -> pts[k]; neighbour k+1 runs pts[k+1] -> pts[k+2].
  const limit = (fixed: Point, isStub: boolean) => {
    const min = isStub ? 12 : 3;
    const dir = Math.sign(from - fixed[key]);
    if (!dir) return;
    // Keep (target - fixed) * dir >= min.
    const bound = fixed[key] + dir * min;
    target = dir > 0 ? Math.max(target, bound) : Math.min(target, bound);
  };
  limit(pts[k - 1], k === 1);
  limit(pts[k + 2], k + 3 === pts.length);
  if (Math.abs(target - from) < 0.25) return;
  const a = { ...pts[k], [key]: target };
  const b = { ...pts[k + 1], [key]: target };
  // Don't push a line into a node. The stubs start on their node's border, so test the interior.
  const moved = [pts[k - 1], a, b, pts[k + 2]];
  if (obstacles.canMove?.(pts, k, moved) === false) return;
  for (const i of obstacles.near(inflate(union(moved.map((p) => ({ ...p, width: 0, height: 0 })))!, 2 + QUERY_SLACK))) {
    const r = obstacles.rects[i];
    if (
      segmentHitsRect(a, b, inflate(r, 2)) ||
      segmentHitsRect(pts[k - 1], a, r, 1) ||
      segmentHitsRect(b, pts[k + 2], r, 1)
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
  const out = new Map([...routes].map(([id, pts]) => [id, pts.map((p) => ({ ...p }))]));
  if ([...routes.keys()].every((id) => opts.fixed?.has(id))) return out;
  const obstacles: Obstacles = new RectIndex(obstacleRects);
  obstacles.canMove = opts.canMove;

  const spread = () => {
    for (const vertical of [true, false]) {
      const segs: Seg[] = [];
      for (const [id, pts] of out) segs.push(...segmentsOf(id, pts, vertical, opts.fixed?.has(id)));
      for (const group of clusterSegments(segs, tol, opts.index)) {
        const ordered = order(group);
        const n = ordered.length;
        let sum = 0,
          lo = Infinity,
          hi = -Infinity;
        for (const g of ordered) {
          sum += g.c;
          lo = Math.min(lo, g.lo);
          hi = Math.max(hi, g.hi);
        }
        const mean = sum / n;
        // Room on each side of the track over the bundle's span, so the spread never reaches a node.
        let below = Infinity,
          above = Infinity;
        // Only the room within `reach` of the track can narrow the step below `sep` (room = reach - 6 gives exactly
        // sep), so the obstacles beyond it are left unread: whatever they are, the step is the same.
        const reach = (sep * (n - 1)) / 2 + 6 + QUERY_SLACK;
        const window = segmentBox({ vertical, c: mean, lo, hi }, reach, QUERY_SLACK);
        for (const i of obstacles.near(window)) {
          const r = obstacles.rects[i];
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
        const slot = (i: number) => mean + (i - (n - 1) / 2) * step;
        const pinnedIdx = ordered.findIndex((g) => g.pinned);
        const shift = pinnedIdx >= 0 ? ordered[pinnedIdx].c - slot(pinnedIdx) : 0;
        ordered.forEach((g, i) => {
          if (g.pinned) return;
          moveSegment(out.get(g.edge)!, g.k, vertical, slot(i) + shift, obstacles);
        });
      }
    }
  };
  spread();
  // Swapping bends can land a segment on someone else's track: spread once more.
  if (resolvePinnedOverlaps(out, obstacles, tol, opts.fixed)) spread();
  return out;
}

/**
 * Two port stubs on the same line (an edge leaving a node and another entering the node across
 * the channel at the same height) can't move, so if they overlap, the bends next to them are in
 * the wrong order: swap those bends' positions so each stub ends before the other begins.
 */
function resolvePinnedOverlaps(
  out: Map<string, Point[]>,
  obstacles: Obstacles,
  tol: number,
  fixed?: ReadonlySet<string>,
): boolean {
  let swapped = false;
  for (const vertical of [false, true]) {
    const segs: Seg[] = [];
    for (const [id, pts] of out)
      if (!fixed?.has(id)) segs.push(...segmentsOf(id, pts, vertical).filter((s) => s.pinned));
    const index = segmentIndex(segs);
    for (let i = 0; i < segs.length; i++)
      // Keep the original pair order: bend swaps depend on earlier successful swaps.
      for (const { item: j } of index
        .query(segmentBox(segs[i], tol, tol))
        .filter(({ item }) => item > i)
        .sort((a, b) => a.item - b.item)) {
        const a = segs[i],
          b = segs[j];
        if (a.edge === b.edge || Math.abs(a.c - b.c) >= tol || Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) <= 2)
          continue;
        const pa = out.get(a.edge)!,
          pb = out.get(b.edge)!;
        const na = a.k === 0 ? 1 : a.k - 1;
        const nb = b.k === 0 ? 1 : b.k - 1;
        // The neighbours must be free interior segments.
        if (na <= 0 || na >= pa.length - 2 || nb <= 0 || nb >= pb.length - 2) continue;
        const key = vertical ? "y" : "x";
        const ca = pa[na][key],
          cb = pb[nb][key];
        const beforeA = pa.slice(),
          beforeB = pb.slice();
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
