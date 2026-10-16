import { boundaryAround, type Box } from "./arrange";

export type BoundaryBox = Box & { group?: string };

/** Fit direct contents bottom-up. Empty boundaries keep their box; parents use each child's
 * planned box. All coordinates are absolute, so callers only adapt ids and measured sizes. */
export function planBoundaryRefits(
  groups: readonly BoundaryBox[],
  elements: readonly BoundaryBox[],
  requested?: ReadonlySet<string>,
): Map<string, ReturnType<typeof boundaryAround>> {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const members = new Map<string, { box: BoundaryBox; child?: string }[]>();
  const boxes = new Map<string, Box>(groups.map((g) => [g.id, g]));
  const remaining = new Map(groups.map((g) => [g.id, 0]));
  const add = (n: BoundaryBox, boundary: boolean) => {
    if (!n.group || !byId.has(n.group)) return;
    const list = members.get(n.group) ?? [];
    list.push({ box: n, child: boundary ? n.id : undefined });
    members.set(n.group, list);
    if (boundary) remaining.set(n.group, remaining.get(n.group)! + 1);
  };
  groups.forEach((g) => add(g, true));
  elements.forEach((n) => add(n, false));
  const ready = groups.filter((g) => !remaining.get(g.id)).map((g) => g.id);
  const refits = new Map<string, ReturnType<typeof boundaryAround>>();
  while (ready.length) {
    const id = ready.pop()!;
    const group = byId.get(id)!;
    const contents = members.get(id) ?? [];
    if (contents.length && (!requested || requested.has(id))) {
      const bounds = boundaryAround(contents.map((n) => (n.child ? boxes.get(n.child)! : n.box)));
      boxes.set(id, { id, ...bounds });
      refits.set(id, bounds);
    }
    if (group.group && remaining.has(group.group)) {
      const left = remaining.get(group.group)! - 1;
      remaining.set(group.group, left);
      if (!left) ready.push(group.group);
    }
  }
  return refits;
}
