import type { ActionContext } from "../../editor/actions";
import { GROUP_PREFIX } from "../types";

/**
 * The flow ids a context menu acts on: its node, connection or boundary, or every item of a selection (boundaries
 * as React Flow knows them, GROUP_PREFIX + their id). A peer deleting any of them closes the menu (reason `remote`).
 * The canvas's own menu acts on nothing in particular.
 */
export function menuTargets(ctx: Pick<ActionContext, "target" | "nodeId" | "edgeId" | "groupId" | "selection">) {
  if (ctx.target === "selection")
    return [
      ...ctx.selection.nodeIds,
      ...ctx.selection.edgeIds,
      ...ctx.selection.groupIds.map((id) => GROUP_PREFIX + id),
    ];
  if (ctx.groupId !== undefined) return [GROUP_PREFIX + ctx.groupId];
  return [ctx.nodeId, ctx.edgeId].filter((id): id is string => !!id);
}

/** Whether a peer's change removed one of a menu's targets (one index of what remains, then one look-up each). */
export function targetRemoved(
  targets: readonly string[] | undefined,
  next: { nodes: readonly { id: string }[]; edges: readonly { id: string }[] },
): boolean {
  if (!targets?.length) return false;
  const remaining = new Set<string>();
  for (const n of next.nodes) remaining.add(n.id);
  for (const e of next.edges) remaining.add(e.id);
  return targets.some((id) => !remaining.has(id));
}
