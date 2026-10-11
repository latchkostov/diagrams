import { expect, it, vi } from "vitest";
import { edgeMarks } from "./edgeMarks";

it("samples each route once until its geometry changes and drops removed paths", () => {
  let geometry = "M 0 0 L 48 0";
  const path = {
    getAttribute: () => geometry,
    getTotalLength: vi.fn(() => 48),
    getPointAtLength: vi.fn((d: number) => ({ x: d, y: geometry === "changed" ? 100 : 0 })),
  };
  let paths = [path];
  const root = { querySelectorAll: () => paths } as unknown as HTMLElement;
  const first = edgeMarks(root);
  expect(first).toEqual([
    { x: -2, y: -2, width: 4, height: 4 },
    { x: 22, y: -2, width: 4, height: 4 },
    { x: 46, y: -2, width: 4, height: 4 },
  ]);
  expect(edgeMarks(root)).toEqual(first);
  expect(path.getTotalLength).toHaveBeenCalledTimes(1);
  expect(path.getPointAtLength).toHaveBeenCalledTimes(3);
  geometry = "changed";
  expect(edgeMarks(root)[0].y).toBe(98);
  expect(path.getTotalLength).toHaveBeenCalledTimes(2);
  paths = [];
  expect(edgeMarks(root)).toEqual([]);
  expect(edgeMarks(null)).toEqual([]);
});
