import { expect, it } from "vitest";
import { obstacleGrid } from "./obstacleGrid";
import { containsStrict, type Rect } from "./rect";

it("matches strict obstacle scans at vertices, midpoints and overlapping borders", () => {
  const obstacles: Rect[] = Array.from({ length: 100 }, (_, i) => ({
    x: ((i * 13) % 53) - 20,
    y: ((i * 7) % 61) - 20,
    width: i % 17,
    height: i % 23,
  }));
  const rulers = [-100, -20, -19.99, -19.98, 0, 0.01, 0.02, 10, 15, 20, 20.99, 21, 100];
  const grid = obstacleGrid(rulers, rulers, obstacles);
  const actual = rulers.flatMap((_, i) => rulers.map((_, j) => Number(grid.has(i, j))));
  const expected = rulers.flatMap((x) =>
    rulers.map((y) => Number(obstacles.some((r) => containsStrict(r, { x, y }, 0.01)))),
  );
  expect(actual).toEqual(expected);
});

it("indexes large ruler sets without materializing their Cartesian product", () => {
  const rulers = Array.from({ length: 100_000 }, (_, i) => i);
  const grid = obstacleGrid(rulers, rulers, [
    { x: 5, y: 5, width: 20, height: 20 },
    { x: 15, y: 15, width: 20, height: 20 },
  ]);
  expect(grid.has(6, 6)).toBe(true);
  expect(grid.has(5, 6)).toBe(false);
  expect(grid.has(20, 20)).toBe(true);
  expect(grid.has(30, 30)).toBe(true);
  expect(grid.has(36, 30)).toBe(false);
  expect(grid.has(99_999, 99_999)).toBe(false);
});
