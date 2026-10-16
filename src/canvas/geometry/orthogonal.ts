// Obstacle-aware orthogonal routing: A* over a sparse orthogonal visibility grid.
//
// The grid's lines ("rulers") are the padded borders of the obstacles near the edge, the two stub
// points, the search region's borders, and the midline of every channel between them. Routes
// therefore run either along a padded border or down the middle of a channel, which reads cleanly.
// Cost = length + a penalty per bend + small penalties for hugging a node and for running along a
// group border, so the search prefers few bends, short paths and clear channels, in that order.

import { inflate, type Point, type Rect, right, bottom, simplify } from "./rect";
import { obstacleGrid } from "./obstacleGrid";
import type { RectIndex } from "./spatial";

export interface SoftLine {
  /** "x": a vertical line at x = at spanning y in [from, to]; "y": horizontal. */
  axis: "x" | "y";
  at: number;
  from: number;
  to: number;
}

export interface OrthoRequest {
  /** Port on the source node's border, and the unit normal pointing out of that side. */
  source: Point;
  sourceDir: Point;
  target: Point;
  targetDir: Point;
  /** Raw obstacle boxes (nodes, group headers); padding is applied here. Include the endpoints' own nodes. */
  obstacles: readonly Rect[];
  /** Lines edges shouldn't run along (group borders). */
  soft?: readonly SoftLine[];
  /** Clearance kept around obstacles. */
  pad?: number;
  /** Length of the straight stub leaving / entering a port before the first bend. */
  stub?: number;
  /**
   * `obstacles` indexed by position (a router routing many edges builds it once): the search area then reads only the
   * obstacles near it, not every one in the diagram. Same route either way.
   */
  index?: RectIndex;
  /** Scratch arrays shared by a router's searches (one pass): spares each search allocating and filling its own. */
  buffers?: SearchBuffers;
}

export interface OrthoOptions {
  bend?: number;
  hug?: number;
  softPenalty?: number;
}

const DIRS: readonly Point[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];
/** DIRS as two arrays, for the search's inner loop. */
const DX = DIRS.map((d) => d.x);
const DY = DIRS.map((d) => d.y);
const dirIndex = (d: Point) => (d.x > 0 ? 0 : d.y > 0 ? 1 : d.x < 0 ? 2 : 3);

/** A binary min-heap of (key, value) pairs in typed arrays, reused across searches: `clear` empties it. */
class MinHeap {
  private k = new Float64Array(1024);
  private v = new Int32Array(1024);
  size = 0;
  clear() {
    this.size = 0;
  }
  push(key: number, val: number) {
    if (this.size === this.k.length) {
      const k = new Float64Array(this.k.length * 2);
      const v = new Int32Array(this.v.length * 2);
      k.set(this.k);
      v.set(this.v);
      this.k = k;
      this.v = v;
    }
    const k = this.k,
      v = this.v;
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop(): number {
    const k = this.k,
      v = this.v;
    const top = v[0];
    const n = --this.size;
    const lk = k[n],
      lv = v[n];
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lk;
      v[i] = lv;
    }
    return top;
  }
}

/**
 * Scratch arrays for many searches in a row (a router's pass): sized for the largest search so far and invalidated by
 * an epoch per search instead of a fresh allocation and fill. A value counts only when its stamp is this search's
 * epoch; otherwise it reads as the fresh array's would (no cost known, distance Infinity, not closed, no parent).
 */
export class SearchBuffers {
  private epoch = 0;
  g = new Float64Array(0);
  parent = new Int32Array(0);
  /** Stamps for g and parent (set together), closed states, link costs, and occupancy. */
  gAt = new Uint32Array(0);
  closedAt = new Uint32Array(0);
  link = new Float64Array(0);
  linkAt = new Uint32Array(0);
  occupied = new Uint8Array(0);
  occupiedAt = new Uint32Array(0);
  readonly heap = new MinHeap();

  /** Starts a search over `states` (cell, direction) pairs and `points` occupancy points; returns its epoch. */
  /**
   * Arrays allocated by every SearchBuffers so far (for tests and benchmarks): a pass's searches share one set, grown a
   * few times to the largest, rather than allocating per search.
   */
  static allocations = 0;

  begin(states: number, points: number): number {
    if (this.g.length < states) {
      const size = Math.max(states, Math.ceil(this.g.length * 1.5));
      SearchBuffers.allocations++;
      this.g = new Float64Array(size);
      this.parent = new Int32Array(size);
      this.gAt = new Uint32Array(size);
      this.closedAt = new Uint32Array(size);
      this.link = new Float64Array(size);
      this.linkAt = new Uint32Array(size);
    }
    if (this.occupied.length < points) {
      const size = Math.max(points, Math.ceil(this.occupied.length * 1.5));
      SearchBuffers.allocations++;
      this.occupied = new Uint8Array(size);
      this.occupiedAt = new Uint32Array(size);
    }
    if (++this.epoch === 0xffffffff) {
      for (const a of [this.gAt, this.closedAt, this.linkAt, this.occupiedAt]) a.fill(0);
      this.epoch = 1;
    }
    return this.epoch;
  }
}

function uniqSorted(vals: number[]): number[] {
  vals.sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of vals) if (!out.length || v - out[out.length - 1] > 0.5) out.push(v);
  return out;
}

/** Spans [a, b) on a ruler, sorted by start, with the furthest end so far: overlap tests in O(log n). */
interface Spans {
  start: number[];
  maxEnd: number[];
}

/** Spans from [a, b] pairs. One with a NaN end can never overlap anything (every comparison is false): left out. */
function spansOf(pairs: [number, number][]): Spans {
  const sorted = pairs.filter(([a, b]) => !Number.isNaN(a) && !Number.isNaN(b)).sort((p, q) => p[0] - q[0]);
  const start: number[] = [];
  const maxEnd: number[] = [];
  let far = -Infinity;
  for (const [a, b] of sorted) {
    far = Math.max(far, b);
    start.push(a);
    maxEnd.push(far);
  }
  return { start, maxEnd };
}

/** Whether some span has `hi > a && lo < b`: among the spans starting before `hi`, one ends after `lo`. */
function overlapsSpan(s: Spans, lo: number, hi: number): boolean {
  const k = lowerBound(s.start, hi);
  return k > 0 && s.maxEnd[k - 1] > lo;
}

/** The first index whose value is at least `v` (sorted values). */
function lowerBound(sorted: readonly number[], v: number): number {
  let lo = 0,
    hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Adds the midline of every gap between consecutive rulers, so routes can take the middle of a channel. */
function withMidlines(vals: number[]): number[] {
  const base = uniqSorted(vals);
  const out = [...base];
  for (let i = 1; i < base.length; i++) if (base[i] - base[i - 1] > 4) out.push((base[i] + base[i - 1]) / 2);
  return uniqSorted(out);
}

/**
 * A* between two stub points inside `region`. Returns the grid path (stub point to stub point) or
 * null when the region has no route.
 */
function search(
  s1: Point,
  sDir: number,
  t1: Point,
  tDir: number,
  obs: readonly Rect[],
  region: Rect,
  soft: readonly SoftLine[],
  o: Required<OrthoOptions>,
  buffers: SearchBuffers,
): Point[] | null {
  const xs = withMidlines([region.x, right(region), s1.x, t1.x, ...obs.flatMap((r) => [r.x, right(r)])]);
  const ys = withMidlines([region.y, bottom(region), s1.y, t1.y, ...obs.flatMap((r) => [r.y, bottom(r)])]);
  const nx = xs.length,
    ny = ys.length;
  // Cap the dense search's allocation/work. The caller retains the existing elbow fallback.
  if (nx * ny > 2_000_000) return null;
  const interleave = (a: number[]) => a.flatMap((v, i) => (i + 1 < a.length ? [v, (v + a[i + 1]) / 2] : [v]));
  const gridY = 2 * ny - 1;
  // Include link midpoints; cached occupancy queries preserve identical border semantics.
  const occupancy = obstacleGrid(interleave(xs), interleave(ys), obs);
  const n = nx * ny * 4;
  const epoch = buffers.begin(n, (2 * nx - 1) * gridY);
  const { g, parent, gAt, closedAt, link, linkAt, occupied, occupiedAt } = buffers;
  const inside = (i: number, j: number) => {
    const k = i * gridY + j;
    if (occupiedAt[k] !== epoch) {
      occupied[k] = occupancy.has(i, j) ? 1 : 0;
      occupiedAt[k] = epoch;
    }
    return occupied[k] === 1;
  };
  const find = (arr: number[], v: number) => {
    let lo = 0,
      hi = arr.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (arr[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    if (lo === arr.length) return lo - 1;
    // Prefer the earlier ruler on a tie, as the original linear scan did.
    return lo > 0 && Math.abs(arr[lo - 1] - v) <= Math.abs(arr[lo] - v) ? lo - 1 : lo;
  };
  const si = find(xs, s1.x),
    sj = find(ys, s1.y),
    ti = find(xs, t1.x),
    tj = find(ys, t1.y);

  const blocked = (i: number, j: number) => !((i === si && j === sj) || (i === ti && j === tj)) && inside(2 * i, 2 * j);

  // Rulers lying on a padded obstacle border, for the "hugging" penalty.
  const hugX = new Map<number, Rect[]>();
  const hugY = new Map<number, Rect[]>();
  for (const r of obs) {
    for (const x of [r.x, right(r)]) {
      const i = find(xs, x);
      if (Math.abs(xs[i] - x) < 0.6) (hugX.get(i) ?? hugX.set(i, []).get(i)!).push(r);
    }
    for (const y of [r.y, bottom(r)]) {
      const j = find(ys, y);
      if (Math.abs(ys[j] - y) < 0.6) (hugY.get(j) ?? hugY.set(j, []).get(j)!).push(r);
    }
  }

  // Each ruler's hugged borders as sorted spans: "does a link along it run beside one?" is a binary search, not a
  // scan of every obstacle on the ruler (a column of aligned nodes shares one).
  const hugSpansX = new Map<number, Spans>();
  const hugSpansY = new Map<number, Spans>();
  for (const [i, list] of hugX) hugSpansX.set(i, spansOf(list.map((r) => [r.y, bottom(r)])));
  for (const [j, list] of hugY) hugSpansY.set(j, spansOf(list.map((r) => [r.x, right(r)])));

  // Soft lines (group borders) by the ruler they run along: a link tests only the lines within 12 px of its own
  // ruler, not every group border in the diagram. Each list keeps the lines' order.
  const softX = new Map<number, SoftLine[]>();
  const softY = new Map<number, SoftLine[]>();
  for (const l of soft) {
    const [rulers, other, byRuler] = l.axis === "x" ? [xs, ys, softX] : [ys, xs, softY];
    // A link spans two neighbouring rulers of the other axis: it can only overlap a line that reaches the grid.
    if (!(l.to > other[0] && l.from < other[other.length - 1])) continue;
    for (let k = lowerBound(rulers, l.at - 13); k < rulers.length && rulers[k] < l.at + 13; k++)
      if (Math.abs(rulers[k] - l.at) < 12) (byRuler.get(k) ?? byRuler.set(k, []).get(k)!).push(l);
  }

  // Link (cell, dir) -> extra cost, or -1 when blocked. Computed lazily.
  const linkCost = (i: number, j: number, d: number): number => {
    const idx = (i * ny + j) * 4 + d;
    if (linkAt[idx] === epoch) return link[idx];
    const i2 = i + DIRS[d].x,
      j2 = j + DIRS[d].y;
    let cost = -1;
    if (i2 >= 0 && i2 < nx && j2 >= 0 && j2 < ny && !blocked(i2, j2)) {
      const x1 = xs[i],
        y1 = ys[j],
        x2 = xs[i2],
        y2 = ys[j2];
      if (!inside(i + i2, j + j2)) {
        const len = Math.abs(x2 - x1) + Math.abs(y2 - y1);
        let extra = 0;
        const vertical = d === 1 || d === 3;
        const lo = vertical ? Math.min(y1, y2) : Math.min(x1, x2);
        const hi = vertical ? Math.max(y1, y2) : Math.max(x1, x2);
        const hug = vertical ? hugSpansX.get(i) : hugSpansY.get(j);
        if (hug && overlapsSpan(hug, lo, hi)) extra += len * o.hug;
        for (const l of (vertical ? softX.get(i) : softY.get(j)) ?? []) {
          const c = vertical ? x1 : y1;
          if (Math.abs(c - l.at) < 12 && hi > l.from && lo < l.to) {
            extra += len * o.softPenalty;
            break;
          }
        }
        cost = len + extra;
      }
    }
    link[idx] = cost;
    linkAt[idx] = epoch;
    return cost;
  };

  const heap = buffers.heap;
  heap.clear();
  const xt = xs[ti],
    yt = ys[tj];
  const h = (i: number, j: number) => Math.abs(xs[i] - xt) + Math.abs(ys[j] - yt);
  const bend = o.bend;
  const start = (si * ny + sj) * 4 + sDir;
  g[start] = 0;
  parent[start] = -1;
  gAt[start] = epoch;
  heap.push(h(si, sj), start);
  const arriveDir = (tDir + 2) % 4; // moving into the target = against its outward normal
  let goal = -1;
  while (heap.size) {
    const s = heap.pop();
    if (closedAt[s] === epoch) continue;
    closedAt[s] = epoch;
    const cell = s >> 2,
      d = s & 3;
    const i = Math.floor(cell / ny),
      j = cell % ny;
    if (i === ti && j === tj) {
      goal = s;
      break;
    }
    // The hot loop: the link cache and the distances read inline (a popped state's distance is always this search's).
    const gs = g[s];
    const links = s - d;
    for (let d2 = 0; d2 < 4; d2++) {
      if (d2 === (d ^ 2)) continue; // no U-turns in place
      const c = linkAt[links + d2] === epoch ? link[links + d2] : linkCost(i, j, d2);
      if (c < 0) continue;
      const i2 = i + DX[d2],
        j2 = j + DY[d2];
      let cost = gs + c + (d2 !== d ? bend : 0);
      if (i2 === ti && j2 === tj) {
        if (d2 === tDir) continue; // would arrive from inside the target
        if (d2 !== arriveDir) cost += bend; // the final turn into the target
      }
      const s2 = (i2 * ny + j2) * 4 + d2;
      if (cost < (gAt[s2] === epoch ? g[s2] : Infinity) - 1e-9) {
        g[s2] = cost;
        parent[s2] = s;
        gAt[s2] = epoch;
        heap.push(cost + h(i2, j2), s2);
      }
    }
  }
  if (goal < 0) return null;
  const pts: Point[] = [];
  for (let s = goal; s >= 0; s = gAt[s] === epoch ? parent[s] : -1) {
    const cell = s >> 2;
    pts.push({ x: xs[Math.floor(cell / ny)], y: ys[cell % ny] });
  }
  pts.reverse();
  // The grid snapped the stubs to the nearest rulers; put the exact points back.
  pts[0] = { ...s1 };
  pts[pts.length - 1] = { ...t1 };
  return pts;
}

const rectEq = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/** Routes one edge. Always returns a polyline from `source` to `target` (a plain elbow if no route exists). */
export function routeOrthogonal(
  req: OrthoRequest,
  opts: OrthoOptions = {},
): { points: Point[]; ok: boolean; region: Rect } {
  const o: Required<OrthoOptions> = { bend: 40, hug: 0.6, softPenalty: 3, ...opts };
  const pad = req.pad ?? 16;
  const stub = req.stub ?? pad;
  const s1 = { x: req.source.x + req.sourceDir.x * stub, y: req.source.y + req.sourceDir.y * stub };
  const t1 = { x: req.target.x + req.targetDir.x * stub, y: req.target.y + req.targetDir.y * stub };

  // Pad obstacles, but never so much that a stub point ends up inside one (nodes placed very close).
  const padOf = (r: Rect) => {
    const p = inflate(r, pad);
    const strict = (q: Point) => q.x > p.x && q.x < right(p) && q.y > p.y && q.y < bottom(p);
    if (!strict(s1) && !strict(t1)) return p;
    // Shrink until both stub points are on or outside the border.
    const need = Math.min(
      ...[s1, t1].map((q) => {
        const dx = Math.max(r.x - q.x, q.x - right(r));
        const dy = Math.max(r.y - q.y, q.y - bottom(r));
        return Math.max(dx, dy);
      }),
    );
    return inflate(r, Math.max(0, Math.min(pad, need)));
  };
  let all: Rect[] | undefined;
  const padded = () => (all ??= req.obstacles.map(padOf));
  // A padded box lies within its obstacle grown by `pad` (by nothing when pad is negative), so the obstacles whose
  // padded box can reach the region are among those near the region grown by as much: the index's candidates,
  // filtered exactly as every padded box would be. Their order doesn't matter: the search sorts the rulers, counts
  // the occupancy, sorts the hugged spans, and the region is a union.
  const index = req.index;
  const paddedOf = new Map<number, Rect>();
  const near = (area: Rect): readonly Rect[] => {
    if (!index) return padded();
    return index.near(inflate(area, Math.max(0, pad) + 4)).map((i) => {
      let p = paddedOf.get(i);
      if (!p) paddedOf.set(i, (p = padOf(req.obstacles[i])));
      return p;
    });
  };

  const margin = pad + 28;
  let region = inflate(boxOf([s1, t1]), margin);
  let obs: Rect[] = [];
  for (let iter = 0; iter < 6; iter++) {
    obs = near(region).filter(
      (r) => r.x < right(region) && right(r) > region.x && r.y < bottom(region) && bottom(r) > region.y,
    );
    const grown = obs.reduce((acc, r) => unionRect(acc, inflate(r, margin)), region);
    if (rectEq(grown, region)) break;
    region = grown;
  }
  const soft = req.soft ?? [];
  const buffers = req.buffers ?? new SearchBuffers();
  let path = search(s1, dirIndex(req.sourceDir), t1, dirIndex(req.targetDir), obs, region, soft, o, buffers);
  if (!path) {
    region = padded().reduce((acc, r) => unionRect(acc, inflate(r, margin)), region);
    path = search(s1, dirIndex(req.sourceDir), t1, dirIndex(req.targetDir), padded(), region, soft, o, buffers);
  }
  if (!path) return { points: simplify(elbow(req.source, s1, t1, req.target, req.sourceDir)), ok: false, region };
  return { points: simplify([req.source, ...path, req.target]), ok: true, region };
}

function boxOf(pts: readonly Point[]): Rect {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs),
    y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(right(a), right(b)) - x, height: Math.max(bottom(a), bottom(b)) - y };
}

/** Fallback: a two-bend elbow through the stubs, no avoidance. */
export function elbow(s: Point, s1: Point, t1: Point, t: Point, sDir: Point): Point[] {
  if (sDir.x !== 0) {
    const mx = (s1.x + t1.x) / 2;
    return [s, s1, { x: mx, y: s1.y }, { x: mx, y: t1.y }, t1, t];
  }
  const my = (s1.y + t1.y) / 2;
  return [s, s1, { x: s1.x, y: my }, { x: t1.x, y: my }, t1, t];
}
