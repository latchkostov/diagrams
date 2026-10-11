import { describe, expect, it } from "vitest";
import { routeOrthogonal } from "./orthogonal";
import { inflate, segmentHitsRect, type Point, type Rect } from "./rect";

const card = (x: number, y: number, width = 220, height = 72): Rect => ({ x, y, width, height });
const R = { x: 1, y: 0 },
  L = { x: -1, y: 0 },
  D = { x: 0, y: 1 },
  U = { x: 0, y: -1 };

const bends = (pts: Point[]) => Math.max(0, pts.length - 2);
const isOrthogonal = (pts: Point[]) => pts.every((p, i) => i === 0 || p.x === pts[i - 1].x || p.y === pts[i - 1].y);
const hits = (pts: Point[], r: Rect, tol = 1) => pts.some((p, i) => i > 0 && segmentHitsRect(pts[i - 1], p, r, tol));

describe("routeOrthogonal", () => {
  it("uses the existing elbow fallback instead of allocating an oversized dense grid", () => {
    const source = { x: 220, y: 36 },
      target = { x: 800_000, y: 280_000 };
    const r = routeOrthogonal({
      source,
      sourceDir: R,
      target,
      targetDir: L,
      obstacles: Array.from({ length: 2000 }, (_, i) => card(i * 400, i * 140)),
    });
    expect(r.ok).toBe(false);
    expect(r.points[0]).toEqual(source);
    expect(r.points.at(-1)).toEqual(target);
    expect(isOrthogonal(r.points)).toBe(true);
  });

  it("draws a straight line between aligned ports", () => {
    const a = card(0, 0),
      b = card(400, 0);
    const r = routeOrthogonal({
      source: { x: 220, y: 36 },
      sourceDir: R,
      target: { x: 400, y: 36 },
      targetDir: L,
      obstacles: [a, b],
    });
    expect(r.ok).toBe(true);
    expect(r.points).toEqual([
      { x: 220, y: 36 },
      { x: 400, y: 36 },
    ]);
  });

  it("uses two bends with the vertical run in the middle of the channel", () => {
    const a = card(0, 0),
      b = card(400, 200);
    const r = routeOrthogonal({
      source: { x: 220, y: 36 },
      sourceDir: R,
      target: { x: 400, y: 236 },
      targetDir: L,
      obstacles: [a, b],
    });
    expect(bends(r.points)).toBe(2);
    expect(r.points[1].x).toBe(310); // midway between 220 and 400
    expect(isOrthogonal(r.points)).toBe(true);
  });

  it("goes around a node that sits in the way, keeping clearance", () => {
    const a = card(0, 0),
      wall = card(300, -100, 100, 272),
      b = card(500, 0);
    const r = routeOrthogonal({
      source: { x: 220, y: 36 },
      sourceDir: R,
      target: { x: 500, y: 36 },
      targetDir: L,
      obstacles: [a, wall, b],
      pad: 16,
    });
    expect(r.ok).toBe(true);
    expect(isOrthogonal(r.points)).toBe(true);
    expect(hits(r.points, inflate(wall, 15))).toBe(false);
    expect(r.points[0]).toEqual({ x: 220, y: 36 });
    expect(r.points[r.points.length - 1]).toEqual({ x: 500, y: 36 });
  });

  it("enters and leaves along the side normals (no first / last segment along a side)", () => {
    const a = card(0, 0),
      b = card(0, 300);
    const r = routeOrthogonal({
      source: { x: 110, y: 72 },
      sourceDir: D,
      target: { x: 110, y: 300 },
      targetDir: U,
      obstacles: [a, b],
    });
    expect(r.points).toEqual([
      { x: 110, y: 72 },
      { x: 110, y: 300 },
    ]);
  });

  it("routes back-edges around both ends instead of through them", () => {
    const a = card(400, 0),
      b = card(0, 0);
    // a's right side to b's left side: has to loop around.
    const r = routeOrthogonal({
      source: { x: 620, y: 36 },
      sourceDir: R,
      target: { x: 0, y: 36 },
      targetDir: L,
      obstacles: [a, b],
    });
    expect(r.ok).toBe(true);
    expect(hits(r.points, a)).toBe(false);
    expect(hits(r.points, b)).toBe(false);
  });

  it("avoids running along a soft line (group border) when an alternative exists", () => {
    const a = card(0, 0),
      b = card(400, 300);
    const soft = [{ axis: "x" as const, at: 310, from: -500, to: 1000 }];
    const r = routeOrthogonal({
      source: { x: 220, y: 36 },
      sourceDir: R,
      target: { x: 400, y: 336 },
      targetDir: L,
      obstacles: [a, b],
      soft,
    });
    const vertical = r.points.find((p, i) => i > 0 && p.x === r.points[i - 1].x && p.y !== r.points[i - 1].y);
    expect(vertical && Math.abs(vertical.x - 310)).toBeGreaterThanOrEqual(12);
  });

  it("falls back to a plain elbow when boxed in", () => {
    const a = card(0, 0);
    const cage = [
      card(-100, -100, 600, 40),
      card(-100, 140, 600, 40),
      card(-100, -100, 40, 280),
      card(460, -100, 40, 280),
    ];
    const b = card(1000, 0);
    const r = routeOrthogonal({
      source: { x: 220, y: 36 },
      sourceDir: R,
      target: { x: 1000, y: 36 },
      targetDir: L,
      obstacles: [a, b, ...cage],
    });
    expect(r.ok).toBe(false);
    expect(r.points[0]).toEqual({ x: 220, y: 36 });
  });
});
