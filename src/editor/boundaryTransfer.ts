import {
  BOUNDARY_PAD,
  BOUNDARY_LABEL_ROOM,
  groupOf,
  planKeep,
  type GroupRect,
  type MemberBox,
  type Rect,
} from "../canvas/membership";
import { boundsOf, findClearTranslation, overlaps, COPY_MARGIN, type Box } from "../canvas/placement";
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
    const obstacles = destination === undefined ? [...occupied, ...currentGroups] : occupied;
    // Start beyond outer faces, regardless of boundary size. The union also supplies an escape
    // from overlapping/nested ancestors; each local collision search retains its fixed budget.
    const surrounding = currentGroups.filter((g) => overlaps(bounds, g));
    const faces = [...surrounding, ...(surrounding.length ? [boundsOf(surrounding)!] : [])];
    // Seeds sit beyond each face and corner. Clear seeds come first, nearest first; an obstructed
    // seed is kept after them, because the bounded local search around it can still reach nearby
    // free space (a corner between neighbouring boundaries).
    const seeds = faces.flatMap((g) => {
      const left = g.x - bounds.x - bounds.width - COPY_MARGIN;
      const right = g.x + g.width - bounds.x + COPY_MARGIN;
      const above = g.y - bounds.y - bounds.height - COPY_MARGIN;
      const below = g.y + g.height - bounds.y + COPY_MARGIN;
      return [
        { x: left, y: 0 },
        { x: right, y: 0 },
        { x: 0, y: above },
        { x: 0, y: below },
        { x: left, y: above },
        { x: right, y: above },
        { x: left, y: below },
        { x: right, y: below },
      ];
    });
    const blocked = (d: XY) =>
      currentGroups.some((g) => overlaps({ ...bounds, x: bounds.x + d.x, y: bounds.y + d.y }, g)) ? 1 : 0;
    const starts =
      destination === undefined && faces.length
        ? [...new Map(seeds.map((d) => [`${d.x},${d.y}`, d])).values()]
            .map((d) => ({ d, blocked: blocked(d), distance: Math.hypot(d.x, d.y) }))
            .sort((a, b) => a.blocked - b.blocked || a.distance - b.distance)
            .slice(0, 24)
            .map(({ d }) => d)
        : [{ x: 0, y: 0 }];
    let delta: XY | null = null;
    for (const start of starts) {
      const local = findClearTranslation(
        boxes.map((n) => ({ ...n, x: n.x + start.x, y: n.y + start.y })),
        obstacles,
        {
          accept: (d) => fit({ x: start.x + d.x, y: start.y + d.y }) !== null,
        },
      );
      if (local) {
        delta = { x: start.x + local.x, y: start.y + local.y };
        break;
      }
    }
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
