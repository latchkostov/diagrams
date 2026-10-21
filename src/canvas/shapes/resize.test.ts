import { describe, expect, it } from "vitest";
import { beginShapeResize, constrainShapeResize, shapeResizeModifier } from "./resize";
describe("active corner resize", () => {
  it("squares a non-square start, preserves its opposite corner and releases Shift", () => {
    const store = {};
    beginShapeResize(store, "a", "top-left", { x: 100, y: 200, width: 160, height: 90 });
    const changes = [{ id: "a", type: "dimensions" as const, resizing: true, dimensions: { width: 200, height: 100 } }];
    shapeResizeModifier(store, true);
    expect(constrainShapeResize(store, changes, 40)).toEqual([
      { ...changes[0], dimensions: { width: 200, height: 200 }, setAttributes: true },
      { id: "a", type: "position", position: { x: 60, y: 90 } },
    ]);
    shapeResizeModifier(store, false);
    expect(constrainShapeResize(store, changes, 40)).toEqual([
      ...changes,
      { id: "a", type: "position", position: { x: 60, y: 190 } },
    ]);
    constrainShapeResize(store, [{ ...changes[0], resizing: false }], 40);
    shapeResizeModifier(store, true);
    expect(constrainShapeResize(store, changes, 40)).toBe(changes);
  });
});

it.each([
  ["top-right", { width: 220, height: 90 }, { x: 100, y: 200 }],
  ["bottom-left", { width: 160, height: 220 }, { x: 100, y: 200 }],
] as const)(
  "restores the opposite corner on Shift release during %s single-axis movement",
  (corner, dimensions, position) => {
    const store = {};
    beginShapeResize(store, "a", corner, { x: 100, y: 200, width: 160, height: 90 });
    shapeResizeModifier(store, true);
    constrainShapeResize(store, [{ id: "a", type: "dimensions", resizing: true, dimensions }], 40);
    shapeResizeModifier(store, false);
    const result = constrainShapeResize(store, [{ id: "a", type: "dimensions", resizing: true, dimensions }], 40);
    expect(result).toContainEqual({ id: "a", type: "position", position });
    expect(result[0]).toMatchObject({ dimensions });
  },
);
