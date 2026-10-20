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
    expect(constrainShapeResize(store, changes, 40)).toBe(changes);
    constrainShapeResize(store, [{ ...changes[0], resizing: false }], 40);
    shapeResizeModifier(store, true);
    expect(constrainShapeResize(store, changes, 40)).toBe(changes);
  });
});
