import type { FlowNode, DiagramFlowNode } from "../canvas/types";
import type { GroupRect, MemberBox, planKeep } from "../canvas/membership";
import type { Box, findClearTranslation } from "../canvas/placement";
import type { XY } from "./types";

/** Editor geometry stays in its existing chunk; this optional command only needs its ports. */
interface PlacementPorts {
  groups(nodes: readonly FlowNode[]): GroupRect[];
  members(nodes: readonly FlowNode[]): MemberBox[];
  box(node: FlowNode): MemberBox;
  obstacles(skip: ReadonlySet<string>): Box[];
  fit: typeof planKeep;
  search: typeof findClearTranslation;
  withGroup(node: FlowNode, group: string): FlowNode;
  commit(nodes: FlowNode[], positions: Map<string, XY>): boolean;
}

/** Plan all missing members before one commit; existing members stay where they are. */
export function placeBoundaryMembers(ns: FlowNode[], ids: readonly string[], groupId: string, p: PlacementPorts) {
  if (!p.groups(ns).some((g) => g.id === groupId)) return false;
  const requested = new Set(ids);
  const missing = ns.filter(
    (n): n is DiagramFlowNode => n.type === "diagram" && requested.has(n.id) && n.data.group !== groupId,
  );
  const occupied = p.obstacles(new Set(missing.map((n) => n.id)));
  const positions = new Map<string, XY>();
  for (const node of missing) {
    const id = node.id;
    const groups = p.groups(ns),
      group = groups.find((g) => g.id === groupId)!;
    const size = p.box(node);
    const start = {
      ...size,
      group: groupId,
      x: Math.round((group.x + (group.width - size.width) / 2) / 10) * 10,
      y: Math.round((group.y + (group.height - size.height) / 2) / 10) * 10,
    };
    const others = p.members(ns).filter((n) => n.id !== id);
    const fit = (at: XY) => p.fit([{ ...start, ...at }], groups, others);
    const delta = p.search([start], occupied, { accept: (d) => fit({ x: start.x + d.x, y: start.y + d.y }) !== null });
    if (!delta) return false;
    const at = { x: start.x + delta.x, y: start.y + delta.y };
    const grow = fit(at)!;
    occupied.push({ ...size, ...at });
    positions.set(id, at);
    ns = ns.map((n) => {
      if (n.id === id) return { ...p.withGroup(n, groupId), position: at };
      const r = n.type === "boundary" ? grow.get(n.data.groupId) : undefined;
      return r ? { ...n, position: { x: r.x, y: r.y }, width: r.width, height: r.height } : n;
    });
  }
  return !positions.size || p.commit(ns, positions);
}
