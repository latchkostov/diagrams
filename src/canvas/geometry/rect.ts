// Pure 2D helpers shared by the router, label placer and overlap audit. Flow coordinates (px at zoom 1).
import type { Side } from "../../model/types";

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const right = (r: Rect) => r.x + r.width;
export const bottom = (r: Rect) => r.y + r.height;
export const centerOf = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

export function inflate(r: Rect, d: number): Rect {
  return { x: r.x - d, y: r.y - d, width: r.width + 2 * d, height: r.height + 2 * d };
}

/** Interiors overlap by more than `tol` on both axes (touching edges don't count). */
export function intersects(a: Rect, b: Rect, tol = 0): boolean {
  return a.x + tol < right(b) && b.x + tol < right(a) && a.y + tol < bottom(b) && b.y + tol < bottom(a);
}

/** Area of the overlap of two rects (0 when disjoint). */
export function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(right(a), right(b)) - Math.max(a.x, b.x);
  const h = Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Strictly inside (not on the border). */
export function containsStrict(r: Rect, p: Point, tol = 0): boolean {
  return p.x > r.x + tol && p.x < right(r) - tol && p.y > r.y + tol && p.y < bottom(r) - tol;
}

export function union(rects: readonly Rect[]): Rect | null {
  if (!rects.length) return null;
  let x1 = Infinity,
    y1 = Infinity,
    x2 = -Infinity,
    y2 = -Infinity;
  for (const r of rects) {
    x1 = Math.min(x1, r.x);
    y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, right(r));
    y2 = Math.max(y2, bottom(r));
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** Bounding box of a segment, as a (possibly zero-width) rect. */
export function segmentBox(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

/**
 * Does segment a→b pass through the interior of r (shrunk by `tol`)? Liang–Barsky clipping, so it
 * works for any segment, not just axis-aligned ones (bezier / straight edges are sampled to segments).
 */
export function segmentHitsRect(a: Point, b: Point, r: Rect, tol = 0): boolean {
  const x1 = r.x + tol,
    y1 = r.y + tol,
    x2 = right(r) - tol,
    y2 = bottom(r) - tol;
  if (x2 <= x1 || y2 <= y1) return false;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0,
    t1 = 1;
  const clip = (p: number, q: number) => {
    if (p === 0) return q > 0; // parallel: inside iff q > 0 (strict, so borders don't count)
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  if (!clip(-dx, a.x - x1) || !clip(dx, x2 - a.x) || !clip(-dy, a.y - y1) || !clip(dy, y2 - a.y)) return false;
  return t1 - t0 > 1e-9;
}

/** Unit direction pointing out of a side. */
export const sideNormal: Record<Side, Point> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

export const isHorizontalSide = (s: Side) => s === "left" || s === "right";

/** Length of a polyline. */
export function polylineLength(pts: readonly Point[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return l;
}

/** Drops duplicate and collinear interior points of an orthogonal / straight polyline. */
export function simplify(pts: readonly Point[], eps = 0.5): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < eps && Math.abs(last.y - p.y) < eps) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2];
      const b = last!;
      const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
      const dot = (b.x - a.x) * (p.x - b.x) + (b.y - a.y) * (p.y - b.y);
      if (Math.abs(cross) < eps && dot >= 0) {
        out[out.length - 1] = p;
        continue;
      }
    }
    out.push(p);
  }
  return out;
}
