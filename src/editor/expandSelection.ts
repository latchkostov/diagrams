import { GROUP_PREFIX, isGroupNode, type FlowNode } from "../canvas/types";
import { expandGroupIds } from "../model/groupHierarchy";
import type { Selection } from "./types";

/** A selected boundary brings every descendant boundary and member along. */
export function expandSelection(sel: Partial<Selection>, allNodes: readonly FlowNode[]) {
  const groupIds = expandGroupIds(
    sel.groupIds ?? [],
    allNodes.filter(isGroupNode).map((n) => ({ id: n.data.groupId, group: n.data.group })),
  );
  const nodeIds = new Set(sel.nodeIds ?? []);
  for (const n of allNodes) {
    if (!isGroupNode(n) && n.data.group && groupIds.has(n.data.group)) {
      nodeIds.add(n.id);
    }
  }
  const flowIds = new Set<string>();
  for (const id of nodeIds) flowIds.add(id);
  for (const g of groupIds) flowIds.add(GROUP_PREFIX + g);
  return { groupIds: [...groupIds], nodeIds: [...nodeIds], flowIds };
}
