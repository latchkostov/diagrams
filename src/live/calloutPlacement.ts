import { inflate, intersects, type Rect } from "../canvas/geometry/rect";

/** Nearest free screen position, including diagonal moves. Each horizontal strip merges
 * forbidden x intervals once; no Cartesian grid of x/y candidates or per-candidate node scan. */
export function calloutOffset(
  desired: Rect,
  pane: { width: number; height: number },
  obstacles: readonly Rect[],
  gap = 12,
): { dx: number; dy: number } | null {
  const maxX = pane.width - desired.width,
    maxY = pane.height - desired.height;
  if (maxX < 0 || maxY < 0) return null;
  const bounds = { x: 0, y: 0, width: pane.width, height: pane.height };
  const blocked = obstacles.map((o) => inflate(o, gap)).filter((o) => intersects(o, bounds));
  const clamp = (v: number, max: number) => Math.max(0, Math.min(v, max));
  const ys = new Set([0, maxY, clamp(desired.y, maxY)]);
  for (const o of blocked) {
    if (o.y - desired.height >= 0) ys.add(o.y - desired.height);
    if (o.y + o.height <= maxY) ys.add(o.y + o.height);
  }
  let best: { dx: number; dy: number } | null = null,
    distance = Infinity;
  for (const y of [...ys].sort((a, b) => Math.abs(a - desired.y) - Math.abs(b - desired.y))) {
    const dy = y - desired.y;
    if (dy * dy > distance) continue;
    const intervals = blocked
      .filter((o) => y < o.y + o.height && o.y < y + desired.height)
      .map((o) => ({ lo: o.x - desired.width, hi: o.x + o.width }))
      .sort((a, b) => a.lo - b.lo);
    const consider = (lo: number, hi: number) => {
      if (hi < lo) return;
      const x = Math.max(lo, Math.min(desired.x, hi)),
        dx = x - desired.x;
      const score = dx * dx + dy * dy;
      if (score < distance) {
        best = { dx, dy };
        distance = score;
      }
    };
    let cursor = 0;
    for (const interval of intervals) {
      if (interval.hi <= cursor) continue;
      if (interval.lo >= cursor) consider(cursor, Math.min(maxX, interval.lo));
      cursor = Math.max(cursor, interval.hi);
      if (cursor > maxX) break;
    }
    if (cursor <= maxX) consider(cursor, maxX);
  }
  return best;
}
