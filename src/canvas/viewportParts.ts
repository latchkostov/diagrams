import type { InternalNode } from "@xyflow/react";
import type { FlowNode } from "./types";
import { SpatialGrid } from "./geometry/spatial";
import { intersects } from "./geometry/rect";

type Geometry = {
  nodes: readonly unknown[];
  nodeLookup: ReadonlyMap<string, InternalNode<FlowNode>>;
  transform: readonly number[];
  width: number;
  height: number;
};

/** Translation alone does not invalidate decorations while the visible membership stays the same. */
export function sameParts(a: ReadonlySet<string> | null | undefined, b: ReadonlySet<string> | null | undefined) {
  if (a === b) return true;
  if (!a || !b || a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/** Canvas-local index for expensive screen decoration only. Never removes or hides a DOM node. */
export function viewportParts() {
  let previous: Geometry["nodes"] | undefined;
  let lookup: Geometry["nodeLookup"] | undefined;
  let grid = new SpatialGrid<string>();
  let retained = new Set<string>();
  return (state: Geometry, protectedIds: readonly (string | undefined)[] = []): Set<string> | null => {
    const [tx, ty, zoom] = state.transform;
    if (!(state.width > 0 && state.height > 0 && zoom > 0) || ![tx, ty, zoom].every(Number.isFinite)) return null;
    if (previous !== state.nodes || lookup !== state.nodeLookup) {
      previous = state.nodes;
      lookup = state.nodeLookup;
      grid = new SpatialGrid();
      retained = new Set();
      for (const node of state.nodeLookup.values()) {
        const at = node.internals.positionAbsolute;
        const width = node.measured?.width,
          height = node.measured?.height;
        if (
          node.selected ||
          node.dragging ||
          !(width && width > 0) ||
          !(height && height > 0) ||
          ![at.x, at.y, width, height].every(Number.isFinite)
        )
          retained.add(node.id);
        if (width && height) grid.insert({ ...at, width, height }, node.id);
      }
    }
    // A screen-space margin includes counter-scaled ink and incoming cards before they reach the pane.
    const area = {
      x: (-tx - 256) / zoom,
      y: (-ty - 256) / zoom,
      width: (state.width + 512) / zoom,
      height: (state.height + 512) / zoom,
    };
    if (!Object.values(area).every(Number.isFinite)) return null;
    const ids = new Set(retained);
    for (const { rect, item } of grid.query(area)) if (intersects(rect, area)) ids.add(item);
    for (const id of protectedIds) if (id) ids.add(id);
    return ids;
  };
}
