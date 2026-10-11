import { bottom, right, type Rect } from "./rect";

/** First coordinate strictly greater than v (or greater/equal for a closing border). */
function bound(values: readonly number[], v: number, strict: boolean): number {
  let lo = 0,
    hi = values.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (values[mid] < v || (strict && values[mid] === v)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

interface Coverage {
  count: number;
  left?: Coverage;
  right?: Coverage;
}

/** Persistent range-add tree: updates copy only the O(log(rulers)) nodes they touch. */
function add(
  node: Coverage | undefined,
  lo: number,
  hi: number,
  from: number,
  to: number,
  delta: number,
): Coverage | undefined {
  const next: Coverage = { count: node?.count ?? 0, left: node?.left, right: node?.right };
  if (from <= lo && hi <= to) {
    next.count += delta;
  } else {
    const mid = Math.floor((lo + hi) / 2);
    if (from < mid) next.left = add(node?.left, lo, mid, from, to, delta);
    if (to > mid) next.right = add(node?.right, mid, hi, from, to, delta);
  }
  return next.count === 0 && !next.left && !next.right ? undefined : next;
}

/**
 * Sweep obstacle intervals over sorted rulers, preserving the router's strict 0.01 border.
 * Store a persistent y-interval tree per x instead of visiting every grid point:
 * O(obstacles * log(rulers) + xs.length) construction, O(log(rulers)) per uncached query.
 */
export function obstacleGrid(xs: readonly number[], ys: readonly number[], obstacles: readonly Rect[]) {
  const events = new Map<number, { lo: number; hi: number; delta: number }[]>();
  const event = (x: number, lo: number, hi: number, delta: number) => {
    const list = events.get(x) ?? [];
    list.push({ lo, hi, delta });
    events.set(x, list);
  };
  for (const r of obstacles) {
    const x1 = bound(xs, r.x + 0.01, true),
      x2 = bound(xs, right(r) - 0.01, false);
    const y1 = bound(ys, r.y + 0.01, true),
      y2 = bound(ys, bottom(r) - 0.01, false);
    if (x1 >= x2 || y1 >= y2) continue;
    event(x1, y1, y2, 1);
    event(x2, y1, y2, -1);
  }
  const roots: (Coverage | undefined)[] = [];
  let root: Coverage | undefined;
  for (let x = 0; x < xs.length; x++) {
    for (const e of events.get(x) ?? []) {
      root = add(root, 0, ys.length, e.lo, e.hi, e.delta);
    }
    roots.push(root);
  }
  return {
    has(x: number, y: number): boolean {
      if (y < 0 || y >= ys.length) return false;
      let node = roots[x],
        lo = 0,
        hi = ys.length;
      while (node) {
        if (node.count > 0) return true;
        if (hi - lo <= 1) return false;
        const mid = Math.floor((lo + hi) / 2);
        if (y < mid) {
          node = node.left;
          hi = mid;
        } else {
          node = node.right;
          lo = mid;
        }
      }
      return false;
    },
  };
}
