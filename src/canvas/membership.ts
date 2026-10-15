// Boundaries that keep up (D12). Pure geometry, shared by the drag preview, the drop, nodes added inside a
// boundary and a boundary's resize. One rule decides membership: the node's centre. The boundary that holds
// it is the smallest one around its centre (a boundary inside another wins).
//
// A member dropped so it pokes out (its centre still inside) grows its boundary to hold it, with the usual
// padding (the same as Add boundary and Fit to contents), in the drop's undo step. A boundary never shrinks
// by itself (Fit to contents does that), and it never grows onto another boundary or onto a node that isn't
// its own: then it stays as it is, and the drag shows it dashed.

export type Rect = { x: number; y: number; width: number; height: number };
export type GroupRect = Rect & { id: string };
/** A node that may belong to a boundary: its box and the boundary it's in now. */
export type MemberBox = Rect & { id: string; group?: string };

/** The padding `boundaryAround` (Add boundary, Fit to contents) leaves around nodes, and room for the label. */
export const BOUNDARY_PAD = 40;
export const BOUNDARY_LABEL_ROOM = 24;

/** What a dragged node is doing to a boundary, as the drag shows it. */
export type Membership =
  /** It will hold dragged nodes it didn't before: outlined in its tone. */
  | "join"
  /** It keeps holding dragged members (they stay in it): outlined in its tone. */
  | "hold"
  /** Dragged members will leave it: dashed. */
  | "leave"
  /** A member pokes out, but growing would land on another boundary or a node: dashed, and it won't grow. */
  | "blocked";

export const centre = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
export const contains = (r: Rect, x: number, y: number) =>
  x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The boundary holding a point: the smallest one around it. */
export function groupAtPoint(groups: readonly GroupRect[], x: number, y: number): string | undefined {
  let best: GroupRect | undefined;
  for (const g of groups) if (contains(g, x, y) && (!best || g.width * g.height < best.width * best.height)) best = g;
  return best?.id;
}

/** The boundary a node belongs to, by the one rule: its centre. */
export const groupOf = (groups: readonly GroupRect[], box: Rect) => {
  const c = centre(box);
  return groupAtPoint(groups, c.x, c.y);
};

/**
 * The boundary grown to hold `box` with the usual padding, or null when `box` already sits inside it (below its
 * label row). Only the sides `box` pokes out of move, out to the padding, onto the 10 px grid; the others stay.
 */
export function growToHold(group: Rect, box: Rect, pad = BOUNDARY_PAD, labelRoom = BOUNDARY_LABEL_ROOM): Rect | null {
  const left = box.x < group.x;
  const top = box.y < group.y + labelRoom;
  const right = box.x + box.width > group.x + group.width;
  const bottom = box.y + box.height > group.y + group.height;
  if (!left && !top && !right && !bottom) return null;
  const x1 = left ? Math.min(group.x, Math.floor((box.x - pad) / 10) * 10) : group.x;
  const y1 = top ? Math.min(group.y, Math.floor((box.y - pad - labelRoom) / 10) * 10) : group.y;
  const x2 = right
    ? Math.max(group.x + group.width, Math.ceil((box.x + box.width + pad) / 10) * 10)
    : group.x + group.width;
  const y2 = bottom
    ? Math.max(group.y + group.height, Math.ceil((box.y + box.height + pad) / 10) * 10)
    : group.y + group.height;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/**
 * True when growing `group` to `grown` would newly cover another boundary or a node that isn't one of its
 * members (`others`: every other node's box with its boundary). What it covered already doesn't count (a
 * boundary nested in it, a neighbour it already touched).
 */
export function growthBlocked(
  group: GroupRect,
  grown: Rect,
  groups: readonly GroupRect[],
  others: readonly MemberBox[],
  planned: ReadonlyMap<string, Rect> = new Map(),
): boolean {
  // Against each other boundary as it will be (grown, if its growth was accepted first).
  for (const g of groups)
    if (g.id !== group.id && overlaps(grown, planned.get(g.id) ?? g) && !overlaps(group, g)) return true;
  for (const o of others) if (o.group !== group.id && overlaps(grown, o) && !overlaps(group, o)) return true;
  return false;
}

/**
 * Where `moving` (nodes, at their new places) land: each one's boundary by its centre, and the boundaries
 * grown to hold their members (several members poking out of one boundary grow it once, to hold all).
 * `others` are the nodes that stay put. Returns the new boundary of each moving node, the boundaries that
 * grow (id → new rect), those that would grow but can't, and per boundary the members that leave it.
 * `keep`: the nodes keep their boundaries wherever they land (Tidy up rearranges members; it doesn't move them
 * out), and only the growth applies.
 */
export function settleMembership(
  moving: readonly MemberBox[],
  groups: readonly GroupRect[],
  others: readonly MemberBox[],
  keep = false,
): {
  group: Map<string, string | undefined>;
  grow: Map<string, Rect>;
  blocked: Set<string>;
  left: Map<string, string[]>;
} {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const group = new Map<string, string | undefined>();
  const left = new Map<string, string[]>();
  // Buckets made once per call and appended to (a drag's preview runs this every frame).
  const byGroup = new Map<string, MemberBox[]>();
  const landed: MemberBox[] = [];
  for (const m of moving) {
    const g = keep && m.group && byId.has(m.group) ? m.group : groupOf(groups, m);
    group.set(m.id, g);
    landed.push(g === m.group ? m : { ...m, group: g });
    if (m.group && m.group !== g) {
      const l = left.get(m.group);
      if (l) l.push(m.id);
      else left.set(m.group, [m.id]);
    }
    if (g) {
      const b = byGroup.get(g);
      if (b) b.push(m);
      else byGroup.set(g, [m]);
    }
  }
  // One plan for every boundary that grows: each proposal (in id order, so the result never depends on the
  // order nodes were dragged in) is checked against the others as they will be, accepted growth included, so
  // two boundaries never grow into each other. The nodes a grown boundary must stay off: the ones that stay
  // put and the moving ones landing elsewhere.
  const grow = new Map<string, Rect>();
  const blocked = new Set<string>();
  const nodes = [...others, ...landed];
  for (const id of [...byGroup.keys()].sort()) {
    const g = byId.get(id)!;
    let rect: Rect = g;
    for (const m of byGroup.get(id)!) rect = growToHold(rect, m) ?? rect;
    if (rect === g) continue;
    if (growthBlocked(g, rect, groups, nodes, grow)) blocked.add(id);
    else grow.set(id, rect);
  }
  return { group, grow, blocked, left };
}

/**
 * Tidy up's check: with every node of `moving` kept in its boundary, can each boundary grow to hold its members
 * where they'd land, without reaching another boundary or a node that isn't its own, and does each node's centre
 * then sit in its own boundary (a node in none, in none)? Returns the growth when it can, null when it can't.
 */
export function planKeep(
  moving: readonly MemberBox[],
  groups: readonly GroupRect[],
  others: readonly MemberBox[],
): Map<string, Rect> | null {
  const s = settleMembership(moving, groups, others, true);
  if (s.blocked.size) return null;
  const after = groups.map((g) => ({ ...g, ...(s.grow.get(g.id) ?? {}) }));
  const ids = new Set(groups.map((g) => g.id));
  for (const m of moving) if (groupOf(after, m) !== (m.group && ids.has(m.group) ? m.group : undefined)) return null;
  return s.grow;
}

/** What a drag shows on each boundary it touches (see `Membership`). */
export function previewMembership(
  moving: readonly MemberBox[],
  groups: readonly GroupRect[],
  others: readonly MemberBox[],
): Map<string, Membership> {
  const s = settleMembership(moving, groups, others);
  const out = new Map<string, Membership>();
  // Most important last: a boundary both left by one node and joined by another shows the join.
  for (const id of s.left.keys()) out.set(id, "leave");
  for (const m of moving) {
    const g = s.group.get(m.id);
    if (!g) continue;
    if (s.blocked.has(g)) out.set(g, "blocked");
    else if (m.group !== g) out.set(g, "join");
    else if (!out.has(g)) out.set(g, "hold");
  }
  return out;
}

/**
 * A boundary resized by hand adopts the nodes now inside it and releases the members now outside it, by the
 * same rule (a node's centre, the smallest boundary around it). Returns each change: node id → its new
 * boundary (undefined: none).
 */
export function membershipAfterResize(
  groupId: string,
  nodes: readonly MemberBox[],
  groups: readonly GroupRect[],
): { adopted: string[]; released: string[]; group: Map<string, string | undefined> } {
  const adopted: string[] = [];
  const released: string[] = [];
  const group = new Map<string, string | undefined>();
  for (const n of nodes) {
    const g = groupOf(groups, n);
    if (n.group === groupId && g !== groupId) {
      released.push(n.id);
      group.set(n.id, g);
    } else if (n.group !== groupId && g === groupId) {
      adopted.push(n.id);
      group.set(n.id, g);
    }
  }
  return { adopted, released, group };
}
