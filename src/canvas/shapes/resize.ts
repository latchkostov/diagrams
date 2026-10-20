import type { NodeChange } from "@xyflow/react";
import type { FlowNode } from "../types";
import type { Rect } from "../geometry/rect";

interface Gesture {
  id: string;
  corner: string;
  start: Rect;
  shift: boolean;
}
const gestures = new WeakMap<object, Gesture>();
export function beginShapeResize(store: object, id: string, corner: string, start: Rect) {
  gestures.set(store, { id, corner, start, shift: false });
}
export function shapeResizeModifier(store: object, shift: boolean) {
  const gesture = gestures.get(store);
  if (gesture) gesture.shift = shift;
}
export function endShapeResize(store: object) {
  gestures.delete(store);
}

/** Corner Shift means 1:1, preserving the opposite corner even from a rectangular start. */
export function constrainShapeResize(
  store: object,
  changes: NodeChange<FlowNode>[],
  minimum: number,
): NodeChange<FlowNode>[] {
  const g = gestures.get(store);
  if (!g) return changes;
  const dimension = changes.find((c) => c.type === "dimensions" && c.id === g.id);
  if (!dimension || dimension.type !== "dimensions") return changes;
  if (dimension.resizing === false) gestures.delete(store);
  if (!g.shift || !dimension.dimensions) return changes;
  const size = Math.max(minimum, dimension.dimensions.width, dimension.dimensions.height);
  const position = {
    x: g.start.x + (g.corner.includes("left") ? g.start.width - size : 0),
    y: g.start.y + (g.corner.includes("top") ? g.start.height - size : 0),
  };
  return [
    ...changes
      .filter((c) => c.type !== "position" || c.id !== g.id)
      .map((c) =>
        c === dimension ? { ...dimension, dimensions: { width: size, height: size }, setAttributes: true as const } : c,
      ),
    { id: g.id, type: "position", position },
  ];
}
