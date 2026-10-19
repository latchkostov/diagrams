import { pointAlong } from "../canvas/geometry/path";
import { inflate, intersects, type Point, type Rect } from "../canvas/geometry/rect";
import { SpatialGrid } from "../canvas/geometry/spatial";

export interface PillSize {
  id: string;
  width: number;
  height: number;
}

/** Geometry-only index, shared across count-only updates. Inflation happens once per obstacle. */
export function callPillObstacles(obstacles: readonly Rect[]) {
  const grid = new SpatialGrid<Rect>();
  for (const obstacle of obstacles) {
    const rect = inflate(obstacle, 4);
    grid.insert(rect, rect);
  }
  return grid;
}

/** Pure, deterministic placement. Dense or offscreen connections wait for room. */
export function placeCallPills(
  pills: readonly PillSize[],
  routes: ReadonlyMap<string, { points: readonly Point[] }>,
  obstacles: SpatialGrid<Rect>,
  viewport: Rect,
) {
  const placed = new Map<string, Rect>();
  const occupied = new SpatialGrid<Rect>();
  for (const { id, width, height } of pills) {
    const route = routes.get(id);
    if (!route?.points.length) continue;
    // One bounded pass over the route, with no spatial queries for offscreen connections.
    const xs = route.points.map((p) => p.x),
      ys = route.points.map((p) => p.y);
    const bounds = {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };
    if (!intersects(inflate(bounds, 64 + Math.max(width, height)), viewport)) continue;
    const budget = { remaining: 2048 };
    let box: Rect | undefined;
    candidates: for (const distance of [16, 40, 64]) {
      for (const fraction of [0.4, 0.6, 0.2, 0.8, 0.5]) {
        const { point, segment } = pointAlong(route.points, fraction);
        const a = route.points[segment],
          b = route.points[segment + 1] ?? a;
        const dx = b.x - a.x,
          dy = b.y - a.y;
        const length = Math.hypot(dx, dy) || 1;
        for (const side of [1, -1]) {
          const candidate = {
            x: point.x - ((side * dy) / length) * distance - width / 2,
            y: point.y + ((side * dx) / length) * distance - height / 2,
            width,
            height,
          };
          if (!intersects(candidate, viewport)) continue;
          const nearby = obstacles.query(candidate, budget);
          const previous = occupied.query(candidate, budget);
          if (!nearby || !previous) break candidates;
          if (
            !nearby.some((r) => intersects(r.rect, candidate)) &&
            !previous.some((r) => intersects(r.rect, candidate))
          ) {
            box = candidate;
            break candidates;
          }
        }
      }
    }
    if (box) {
      placed.set(id, box);
      const padded = inflate(box, 4);
      occupied.insert(padded, padded);
    }
  }
  return placed;
}
