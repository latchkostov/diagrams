import { expandGroupIds } from "../model/groupHierarchy";
import type { Selection } from "./types";

/** Model IDs only: selected descendants are carried by their outermost selected boundary. */
export function arrangementSelection(
  selection: Pick<Selection, "nodeIds" | "groupIds">,
  groups: readonly { id: string; group?: string }[],
  elements: readonly { id: string; group?: string }[],
): Pick<Selection, "nodeIds" | "groupIds"> {
  const covered = expandGroupIds(selection.groupIds, groups);
  const nodes = new Set(selection.nodeIds);
  const selectedGroups = new Set(selection.groupIds);
  const outside = (n: { group?: string }) => !n.group || !covered.has(n.group);
  return {
    nodeIds: elements.filter((n) => nodes.has(n.id) && outside(n)).map((n) => n.id),
    groupIds: groups.filter((g) => selectedGroups.has(g.id) && outside(g)).map((g) => g.id),
  };
}
