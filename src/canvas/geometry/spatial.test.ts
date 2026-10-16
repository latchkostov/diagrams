import { readFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { expect, it, vi } from "vitest";
import { SpatialGrid } from "./spatial";
import type { Rect } from "./rect";

it("charges empty columns and cells, and skips an empty grid entirely", () => {
  const rect = { x: 0, y: 0, width: 10080, height: 10080 };
  const empty = new SpatialGrid();
  const get = vi.spyOn(Map.prototype, "get");
  try {
    expect(empty.query(rect, { remaining: 8 })).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  } finally {
    get.mockRestore();
  }
  const grid = new SpatialGrid();
  grid.insert({ x: 0, y: 20000, width: 0, height: 0 }, "far row");
  expect(grid.query(rect, { remaining: 8 })).toBeNull();
  const columns = new SpatialGrid();
  columns.insert({ x: 20000, y: 20000, width: 0, height: 0 }, "far column");
  expect(columns.query(rect, { remaining: 8 })).toBeNull();
});

it.each([false, true])("bounds entry scans for overflow and oversized queries (%s)", (oversized) => {
  const grid = new SpatialGrid();
  for (let i = 0; i < 100; i++) grid.insert({ x: i, y: 0, width: oversized ? 1 : 1000000, height: 1 }, i);
  const budget = { remaining: 3 };
  expect(grid.query({ x: 0, y: 0, width: oversized ? 1000000 : 1, height: 1 }, budget)).toBeNull();
  expect(budget.remaining).toBe(-1);
});

it("terminates for extreme coordinates, extents and cell sizes without losing valid hits", async () => {
  // Run hostile inputs off-thread so a regression reports a failure instead of hanging Vitest.
  const source = transpileModule(readFileSync(new URL("./spatial.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
  }).outputText;
  const worker = new Worker(
    `${source}
    const { parentPort } = require('node:worker_threads');
    const results = [];
    for (const cell of [160, Number.MIN_VALUE, 0, -1, Infinity, NaN]) {
      const grid = new exports.SpatialGrid(cell);
      for (const rect of [
        { x: 1e20, y: -1e20, width: 220, height: 72 },
        { x: -1e20, y: -1e20, width: 2e20, height: 2e20 },
        { x: 1e-300, y: 1e-300, width: 1e-300, height: 1e-300 },
        { x: 0, y: 0, width: 1e9, height: 1e9 },
      ]) {
        grid.insert(rect, results.length);
        results.push(grid.query(rect).some(e => e.item === results.length));
      }
    }
    parentPort.postMessage(results);
  `,
    { eval: true },
  );
  try {
    const results = await new Promise<boolean[]>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("SpatialGrid exceeded its work budget")), 1000);
      worker.once("message", (value: boolean[]) => {
        clearTimeout(timer);
        resolve(value);
      });
      worker.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    expect(results).toEqual(Array<boolean>(24).fill(true));
  } finally {
    await worker.terminate();
  }
});

it("ignores non-finite, negative and overflowing rectangles", () => {
  const grid = new SpatialGrid<string>();
  const bad: Rect[] = [
    { x: NaN, y: 0, width: 1, height: 1 },
    { x: 0, y: Infinity, width: 1, height: 1 },
    { x: 0, y: 0, width: -1, height: 1 },
    { x: Number.MAX_VALUE, y: 0, width: Number.MAX_VALUE, height: 1 },
  ];
  for (const r of bad) {
    grid.insert(r, "invalid");
    expect(grid.query(r)).toEqual([]);
  }
  expect(grid.query({ x: 0, y: 0, width: 1000, height: 1000 })).toEqual([]);
});

it("preserves queries after exhausting the grid entry budget", () => {
  const grid = new SpatialGrid<number>(1);
  const r = { x: 0, y: 0, width: 63, height: 63 };
  for (let i = 0; i < 100; i++) grid.insert(r, i);
  expect(
    grid
      .query({ x: 30, y: 30, width: 0, height: 0 })
      .map((e) => e.item)
      .sort((a, b) => a - b),
  ).toEqual(Array.from({ length: 100 }, (_, i) => i));
});

it("does not collide distant cells or duplicate multi-cell entries", () => {
  const grid = new SpatialGrid<string>(1);
  grid.insert({ x: 1, y: 0, width: 0, height: 0 }, "near");
  grid.insert({ x: 0, y: 65536, width: 0, height: 0 }, "far");
  expect(grid.query({ x: 1, y: 0, width: 0, height: 0 }).map((e) => e.item)).toEqual(["near"]);
  grid.insert({ x: -2, y: -2, width: 4, height: 4 }, "wide");
  expect(grid.query({ x: -2, y: -2, width: 4, height: 4 }).filter((e) => e.item === "wide")).toHaveLength(1);
});
