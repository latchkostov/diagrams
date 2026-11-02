import {
  BOUNDARY_PAD,
  BOUNDARY_LABEL_ROOM,
  groupOf,
  planKeep,
  type GroupRect,
  type MemberBox,
  type Rect,
} from "../canvas/membership";
import { boundsOf, findClearTranslation, type Box } from "../canvas/placement";
import type { XY } from "./types";

export interface BoundaryTransfer {
  positions: Map<string, XY>;
  growth: Map<string, Rect>;
  members: Map<string, string | undefined>;
}

/** Pure preflight: rigid subsets, one snapshot, no partial edits on failure. */
export function planBoundaryTransfer(
  nodes: readonly MemberBox[],
  groups: readonly GroupRect[],
  ids: readonly string[],
  destination: string | undefined,
  obstacles: readonly Box[] = [],
): BoundaryTransfer | null {
  const wanted = new Set(ids);
  const moving = nodes.filter((n) => wanted.has(n.id) && n.group !== destination);
  const target = destination === undefined ? undefined : groups.find((g) => g.id === destination);
  if (destination !== undefined && !target) return null;
  const plan: BoundaryTransfer = { positions: new Map(), growth: new Map(), members: new Map() };
  if (!moving.length) return plan;
  const movingIds = new Set(moving.map((n) => n.id));
  const stay = nodes.filter((n) => !movingIds.has(n.id));
  const occupied: Box[] = [...stay, ...obstacles];
  const subsets =
    destination === undefined
      ? [...new Set(moving.map((n) => n.group))].map((group) => moving.filter((n) => n.group === group))
      : [moving];
  let currentGroups = [...groups];
  for (const subset of subsets) {
    const bounds = boundsOf(subset)!;
    // Start at the nearest point in the requested box; preserve every relative offset.
    const enclosed =
      target &&
      subset.every(
        (n) =>
          n.x >= target.x &&
          n.y >= target.y + BOUNDARY_LABEL_ROOM &&
          n.x + n.width <= target.x + target.width &&
          n.y + n.height <= target.y + target.height,
      );
    const shift =
      target && !enclosed
        ? {
            x:
              Math.min(
                Math.max(bounds.x, target.x + BOUNDARY_PAD),
                Math.max(target.x + BOUNDARY_PAD, target.x + target.width - bounds.width - BOUNDARY_PAD),
              ) - bounds.x,
            y:
              Math.min(
                Math.max(bounds.y, target.y + BOUNDARY_PAD + BOUNDARY_LABEL_ROOM),
                Math.max(
                  target.y + BOUNDARY_PAD + BOUNDARY_LABEL_ROOM,
                  target.y + target.height - bounds.height - BOUNDARY_PAD,
                ),
              ) - bounds.y,
          }
        : { x: 0, y: 0 };
    const boxes = subset.map((n) => ({ ...n, x: n.x + shift.x, y: n.y + shift.y, group: destination }));
    const fit = (delta: XY) => {
      const at = boxes.map((n) => ({ ...n, x: n.x + delta.x, y: n.y + delta.y }));
      const growth = planKeep(at, currentGroups, [
        ...stay,
        ...moving
          .filter((n) => plan.positions.has(n.id))
          .map((n) => ({ ...n, ...plan.positions.get(n.id)!, group: destination })),
      ]);
      if (!growth) return null;
      const grown = currentGroups.map((g) => ({ ...g, ...growth.get(g.id) }));
      if (at.some((n) => groupOf(grown, n) !== destination)) return null;
      return growth;
    };
    const delta = findClearTranslation(boxes, destination === undefined ? [...occupied, ...currentGroups] : occupied, {
      accept: (d) => fit(d) !== null,
    });
    if (!delta) return null;
    const growth = fit(delta)!;
    currentGroups = currentGroups.map((g) => ({ ...g, ...growth.get(g.id) }));
    for (const [id, rect] of growth) plan.growth.set(id, rect);
    for (const box of boxes) {
      const position = { x: box.x + delta.x, y: box.y + delta.y };
      plan.positions.set(box.id, position);
      plan.members.set(box.id, destination);
      occupied.push({ ...box, ...position });
    }
  }
  return plan;
}
