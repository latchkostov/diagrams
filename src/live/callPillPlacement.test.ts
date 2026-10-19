import { afterEach, expect, it, vi } from "vitest";
import * as rect from "../canvas/geometry/rect";
import * as path from "../canvas/geometry/path";
import { SpatialGrid } from "../canvas/geometry/spatial";
import { LINEAR_LIMIT } from "../test/complexity";
import { callPillObstacles, placeCallPills } from "./callPillPlacement";

const operations = vi.hoisted(() => ({ intersections: 0 }));
vi.mock("../canvas/geometry/rect", async (original) => {
  const actual = await original<typeof rect>();
  return {
    ...actual,
    intersects: (...args: Parameters<typeof rect.intersects>) => {
      operations.intersections++;
      return actual.intersects(...args);
    },
  };
});
afterEach(() => vi.restoreAllMocks());

it("keeps collision work linear at 5,000 nodes and active connections", () => {
  const run = (count: number) => {
    operations.intersections = 0;
    const obstacles = Array.from({ length: count }, (_, i) => ({ x: i * 400, y: 0, width: 220, height: 72 }));
    const routes = new Map(
      obstacles.map((r, i) => [
        String(i),
        {
          points: [
            { x: r.x + 220, y: 36 },
            { x: r.x + 400, y: 36 },
          ],
        },
      ]),
    );
    const sizes = obstacles.map((_, i) => ({ id: String(i), width: 80, height: 20 }));
    expect(
      placeCallPills(sizes, routes, callPillObstacles(obstacles), { x: 0, y: -100, width: count * 400, height: 300 })
        .size,
    ).toBe(count);
    return operations.intersections;
  };
  const small = run(625),
    large = run(5000);
  expect(large / small).toBeLessThan(LINEAR_LIMIT);
  expect(large).toBeLessThan(5000 * 24);
});

it("skips spatial queries for offscreen connections", () => {
  const query = vi.spyOn(SpatialGrid.prototype, "query");
  const sample = vi.spyOn(path, "pointAlong");
  const routes = new Map(
    Array.from({ length: 5000 }, (_, i) => [
      String(i),
      {
        points: [
          { x: 10000 + i, y: 0 },
          { x: 11000 + i, y: 0 },
        ],
      },
    ]),
  );
  const sizes = [...routes.keys()].map((id) => ({ id, width: 80, height: 20 }));
  expect(placeCallPills(sizes, routes, callPillObstacles([]), { x: 0, y: 0, width: 1000, height: 800 }).size).toBe(0);
  expect(query).not.toHaveBeenCalled();
  expect(sample).not.toHaveBeenCalled();
});

it("places several simultaneous pills clear of each other and readouts", () => {
  const readout = { x: 330, y: 79, width: 320, height: 21 };
  const points = [
    { x: 440, y: 72 },
    { x: 440, y: 200 },
  ];
  const sizes = ["one", "two", "three"].map((id) => ({ id, width: 100, height: 20 }));
  const boxes = [
    ...placeCallPills(sizes, new Map(sizes.map(({ id }) => [id, { points }])), callPillObstacles([readout]), {
      x: 0,
      y: 0,
      width: 1000,
      height: 800,
    }).values(),
  ];
  expect(boxes).toHaveLength(3);
  for (const [i, box] of boxes.entries()) {
    expect(rect.intersects(readout, box)).toBe(false);
    for (const other of boxes.slice(i + 1)) expect(rect.intersects(rect.inflate(box, 4), other)).toBe(false);
  }
});
