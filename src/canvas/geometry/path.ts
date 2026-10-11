import type { Point } from "./rect";

const f = (v: number) => Math.round(v * 10) / 10;

/**
 * SVG path through a polyline with rounded corners (quadratic curves). The radius shrinks on short
 * segments so corners never overshoot. One path per edge: the live view samples it for particles.
 */
export function roundedPath(pts: readonly Point[], radius = 10): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M${f(pts[0].x)},${f(pts[0].y)}`;
  let d = `M${f(pts[0].x)},${f(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1],
      c = pts[i],
      n = pts[i + 1];
    const l1 = Math.hypot(c.x - p.x, c.y - p.y);
    const l2 = Math.hypot(n.x - c.x, n.y - c.y);
    const r = Math.min(radius, l1 / 2, l2 / 2);
    if (r < 0.5) {
      d += ` L${f(c.x)},${f(c.y)}`;
      continue;
    }
    const a = { x: c.x + ((p.x - c.x) / l1) * r, y: c.y + ((p.y - c.y) / l1) * r };
    const b = { x: c.x + ((n.x - c.x) / l2) * r, y: c.y + ((n.y - c.y) / l2) * r };
    d += ` L${f(a.x)},${f(a.y)} Q${f(c.x)},${f(c.y)} ${f(b.x)},${f(b.y)}`;
  }
  const last = pts[pts.length - 1];
  d += ` L${f(last.x)},${f(last.y)}`;
  return d;
}

/** Samples a cubic bezier into a polyline (for label placement and the overlap audit). */
export function sampleCubic(p0: Point, p1: Point, p2: Point, p3: Point, steps = 16): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps,
      u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    });
  }
  return out;
}

/** Point at `t` (0..1) of the polyline's length, plus the index of the segment it falls on. */
export function pointAlong(pts: readonly Point[], t: number): { point: Point; segment: number } {
  let total = 0;
  const lens: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    lens.push(l);
    total += l;
  }
  let want = total * t;
  for (let i = 0; i < lens.length; i++) {
    if (want <= lens[i] || i === lens.length - 1) {
      const k = lens[i] ? Math.min(1, want / lens[i]) : 0;
      return {
        point: { x: pts[i].x + (pts[i + 1].x - pts[i].x) * k, y: pts[i].y + (pts[i + 1].y - pts[i].y) * k },
        segment: i,
      };
    }
    want -= lens[i];
  }
  return { point: { ...pts[0] }, segment: 0 };
}
