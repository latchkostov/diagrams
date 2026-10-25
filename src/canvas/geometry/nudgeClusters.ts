import type { Rect } from "./rect";
import { SpatialGrid } from "./spatial";
import type { Seg } from "./nudge";

export function segmentBox(s: Pick<Seg, "vertical" | "c" | "lo" | "hi">, reach = 0, pad = 0): Rect {
  const perp = s.c - reach,
    along = s.lo - pad,
    thickness = 2 * reach,
    span = s.hi - s.lo + 2 * pad;
  return s.vertical
    ? { x: perp, y: along, width: thickness, height: span }
    : { x: along, y: perp, width: span, height: thickness };
}

type Candidates = (segment: Seg, tolerance: number) => Iterable<{ item: number }>;
export type CandidateIndex = (segments: Seg[]) => Candidates;

/** Shared grid construction also serves the pinned-stub overlap pass. */
export function segmentIndex(segments: Seg[]) {
  const index = new SpatialGrid<number>();
  segments.forEach((s, i) => index.insert(segmentBox(s), i));
  return index;
}

/** Both spatial indexes supply candidates; pair ownership and clustering rules live here. */
export function clusterSegments(
  segs: Seg[],
  tolerance: number,
  candidates: CandidateIndex = (segments) => {
    const index = segmentIndex(segments);
    return (s, tolerance) => index.query(segmentBox(s, tolerance, tolerance));
  },
): Seg[][] {
  const sorted = segs.sort((a, b) => a.c - b.c);
  const near = candidates(sorted);
  const parent = sorted.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  // Fixed routes constrain mutable neighbours, but never need comparisons against each other.
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    if (a.fixed) continue;
    for (const { item: j } of near(a, tolerance)) {
      const b = sorted[j];
      if (
        (!b.fixed && j <= i) ||
        a.edge === b.edge ||
        Math.abs(a.c - b.c) >= tolerance ||
        !(Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) > 2)
      )
        continue;
      parent[find(i)] = find(j);
    }
  }
  const groups: Seg[][] = [];
  const byRoot: Seg[][] = [];
  sorted.forEach((s, i) => {
    const root = find(i);
    if (!byRoot[root]) groups.push((byRoot[root] = []));
    byRoot[root].push(s);
  });
  // Only different edges can be joined, so every non-singleton group contains multiple edges.
  return groups.filter((g) => g.length > 1);
}
