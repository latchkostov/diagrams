import type { NavStep } from "./useCanvasShortcuts";
import { edgesBetween, pickInBox, type BoxItem } from "../canvas/gestures";
import type { Rect } from "../canvas/geometry/rect";

export type SelectionTarget = { kind: "node" | "edge"; id: string };
export type SelectionCommand =
  | { type: "extend"; target: SelectionTarget }
  | { type: "navigate"; step: NavStep }
  | { type: "remove"; target: SelectionTarget }
  | { type: "area"; from: string; to: string; contain: boolean; add: boolean };
export interface SelectionPick {
  nodes: readonly string[];
  edges: readonly string[];
}
const key = (target: SelectionTarget) => `${target.kind}:${target.id}`;
export const pickCount = (pick: SelectionPick) => pick.nodes.length + pick.edges.length;

/** Selection changes never expand boundary operands or infer incident edges. */
export function extendPick(pick: SelectionPick, target: SelectionTarget): SelectionPick {
  const which = target.kind === "node" ? "nodes" : "edges";
  return pick[which].includes(target.id) ? pick : { ...pick, [which]: [...pick[which], target.id] };
}

/** Next remaining selected item after the removed item in reading order, wrapping once. */
export function removePick(pick: SelectionPick, target: SelectionTarget, order: readonly SelectionTarget[]) {
  const which = target.kind === "node" ? "nodes" : "edges";
  if (!pick[which].includes(target.id)) return null;
  const next = { ...pick, [which]: pick[which].filter((id) => id !== target.id) };
  const has = (item: SelectionTarget) => next[item.kind === "node" ? "nodes" : "edges"].includes(item.id);
  const index = order.findIndex((item) => key(item) === key(target));
  const cycle = index < 0 ? order : [...order.slice(index + 1), ...order.slice(0, index)];
  return { pick: next, target: cycle.find(has) };
}

/** Full rendered bounds of both anchors define the region. Uses the pointer selector's exact rules. */
export function pickArea(
  items: readonly BoxItem[],
  edges: readonly { id: string; source: string; target: string; hidden?: boolean }[],
  from: string,
  to: string,
  contain: boolean,
  base?: SelectionPick,
): { rect: Rect; pick: SelectionPick } | null {
  const a = items.find((item) => item.id === from),
    b = items.find((item) => item.id === to);
  if (!a || !b) return null;
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  const rect = {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
  if (!(rect.width > 0 && rect.height > 0)) return null;
  const nodes = new Set([...(base?.nodes ?? []), ...pickInBox(items, rect, contain)]);
  const pickedEdges = edgesBetween(
    edges.filter((e) => !e.hidden),
    nodes,
  );
  for (const id of base?.edges ?? []) pickedEdges.add(id);
  return { rect, pick: { nodes: [...nodes], edges: [...pickedEdges] } };
}
