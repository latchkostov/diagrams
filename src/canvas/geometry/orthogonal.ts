// Obstacle-aware orthogonal routing: A* over a sparse orthogonal visibility grid.
//
// The grid's lines ("rulers") are the padded borders of the obstacles near the edge, the two stub
// points, the search region's borders, and the midline of every channel between them. Routes
// therefore run either along a padded border or down the middle of a channel, which reads cleanly.
// Cost = length + a penalty per bend + small penalties for hugging a node and for running along a
// group border, so the search prefers few bends, short paths and clear channels, in that order.

import { inflate, type Point, type Rect, right, bottom, simplify } from "./rect";

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
const dirIndex = (d: Point) => (d.x > 0 ? 0 : d.y > 0 ? 1 : d.x < 0 ? 2 : 3);

class MinHeap {
  private k: number[] = [];
  private v: number[] = [];
  get size() {
    return this.k.length;
  }
  push(key: number, val: number) {
    const k = this.k,
      v = this.v;
    let i = k.length;
    k.push(key);
    v.push(val);
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
    const lk = k.pop()!;
    const lv = v.pop()!;
    if (k.length) {
      let i = 0;
      const n = k.length;
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

function uniqSorted(vals: number[]): number[] {
  vals.sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of vals) if (!out.length || v - out[out.length - 1] > 0.5) out.push(v);
  return out;
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
): Point[] | null {
  const xs = withMidlines([region.x, right(region), s1.x, t1.x, ...obs.flatMap((r) => [r.x, right(r)])]);
  const ys = withMidlines([region.y, bottom(region), s1.y, t1.y, ...obs.flatMap((r) => [r.y, bottom(r)])]);
  const nx = xs.length,
    ny = ys.length;
  const inside = (x: number, y: number) => {
    for (const r of obs)
      if (x > r.x + 0.01 && x < right(r) - 0.01 && y > r.y + 0.01 && y < bottom(r) - 0.01) return true;
    return false;
  };
  const find = (arr: number[], v: number) => {
    let best = 0;
    for (let i = 1; i < arr.length; i++) if (Math.abs(arr[i] - v) < Math.abs(arr[best] - v)) best = i;
    return best;
  };
  const si = find(xs, s1.x),
    sj = find(ys, s1.y),
    ti = find(xs, t1.x),
    tj = find(ys, t1.y);

  const blocked = new Uint8Array(nx * ny);
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) if (inside(xs[i], ys[j])) blocked[i * ny + j] = 1;
  blocked[si * ny + sj] = 0;
  blocked[ti * ny + tj] = 0;

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

  // Link (cell, dir) -> extra cost, or -1 when blocked. Computed lazily.
  const linkCache = new Float64Array(nx * ny * 4).fill(NaN);
  const linkCost = (i: number, j: number, d: number): number => {
    const idx = (i * ny + j) * 4 + d;
    const cached = linkCache[idx];
    if (!Number.isNaN(cached)) return cached;
    const i2 = i + DIRS[d].x,
      j2 = j + DIRS[d].y;
    let cost = -1;
    if (i2 >= 0 && i2 < nx && j2 >= 0 && j2 < ny && !blocked[i2 * ny + j2]) {
      const x1 = xs[i],
        y1 = ys[j],
        x2 = xs[i2],
        y2 = ys[j2];
      if (!inside((x1 + x2) / 2, (y1 + y2) / 2)) {
        const len = Math.abs(x2 - x1) + Math.abs(y2 - y1);
        let extra = 0;
        const vertical = d === 1 || d === 3;
        const lo = vertical ? Math.min(y1, y2) : Math.min(x1, x2);
        const hi = vertical ? Math.max(y1, y2) : Math.max(x1, x2);
        for (const r of (vertical ? hugX.get(i) : hugY.get(j)) ?? []) {
          const a = vertical ? r.y : r.x;
          const b = vertical ? bottom(r) : right(r);
          if (hi > a && lo < b) {
            extra += len * o.hug;
            break;
          }
        }
        for (const l of soft) {
          if ((l.axis === "x") !== vertical) continue;
          const c = vertical ? x1 : y1;
          if (Math.abs(c - l.at) < 12 && hi > l.from && lo < l.to) {
            extra += len * o.softPenalty;
            break;
          }
        }
        cost = len + extra;
      }
    }
    linkCache[idx] = cost;
    return cost;
  };

  const n = nx * ny * 4;
  const g = new Float64Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap = new MinHeap();
  const h = (i: number, j: number) => Math.abs(xs[i] - xs[ti]) + Math.abs(ys[j] - ys[tj]);
  const start = (si * ny + sj) * 4 + sDir;
  g[start] = 0;
  heap.push(h(si, sj), start);
  const arriveDir = (tDir + 2) % 4; // moving into the target = against its outward normal
  let goal = -1;
  while (heap.size) {
    const s = heap.pop();
    if (closed[s]) continue;
    closed[s] = 1;
    const cell = s >> 2,
      d = s & 3;
    const i = Math.floor(cell / ny),
      j = cell % ny;
    if (i === ti && j === tj) {
      goal = s;
      break;
    }
    for (let d2 = 0; d2 < 4; d2++) {
      if (d2 === (d + 2) % 4) continue; // no U-turns in place
      const c = linkCost(i, j, d2);
      if (c < 0) continue;
      const i2 = i + DIRS[d2].x,
        j2 = j + DIRS[d2].y;
      let cost = g[s] + c + (d2 !== d ? o.bend : 0);
      if (i2 === ti && j2 === tj) {
        if (d2 === tDir) continue; // would arrive from inside the target
        if (d2 !== arriveDir) cost += o.bend; // the final turn into the target
      }
      const s2 = (i2 * ny + j2) * 4 + d2;
      if (cost < g[s2] - 1e-9) {
        g[s2] = cost;
        parent[s2] = s;
        heap.push(cost + h(i2, j2), s2);
      }
    }
  }
  if (goal < 0) return null;
  const pts: Point[] = [];
  for (let s = goal; s >= 0; s = parent[s]) {
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
  const padded = req.obstacles.map((r) => {
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
  });

  const margin = pad + 28;
  let region = inflate(boxOf([s1, t1]), margin);
  let obs: Rect[] = [];
  for (let iter = 0; iter < 6; iter++) {
    obs = padded.filter(
      (r) => r.x < right(region) && right(r) > region.x && r.y < bottom(region) && bottom(r) > region.y,
    );
    const grown = obs.reduce((acc, r) => unionRect(acc, inflate(r, margin)), region);
    if (rectEq(grown, region)) break;
    region = grown;
  }
  const soft = req.soft ?? [];
  let path = search(s1, dirIndex(req.sourceDir), t1, dirIndex(req.targetDir), obs, region, soft, o);
  if (!path) {
    region = padded.reduce((acc, r) => unionRect(acc, inflate(r, margin)), region);
    path = search(s1, dirIndex(req.sourceDir), t1, dirIndex(req.targetDir), padded, region, soft, o);
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
