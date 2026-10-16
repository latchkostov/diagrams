import type { InternalNode } from "@xyflow/react";

/** Readiness is terminal for one Lab stage; viewport store updates need no more node reads. */
export function labNodesReady(nodes: ReadonlyMap<string, InternalNode>, expected: number, reported: boolean): boolean {
  if (reported) return true;
  if (nodes.size !== expected) return false;
  for (const node of nodes.values()) {
    if (node.hidden) continue;
    if (
      node.type === "boundary" &&
      ((node.width !== undefined && Math.round(node.width) === 0) ||
        (node.height !== undefined && Math.round(node.height) === 0))
    )
      continue;
    if (!node.internals.handleBounds || !node.measured.width || !node.measured.height) return false;
  }
  return true;
}
