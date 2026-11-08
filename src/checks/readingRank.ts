import type { DiagramEdge, DiagramFile } from "../model/types";
import { readingOrder } from "../canvas/keyboardNav";
import { estimateCardSize } from "../canvas/nodes/size";

/** Reading order only: no topology, capacity or analysis context is needed to present findings. */
export function buildReadingRank(
  diagram: DiagramFile,
  edges: ReadonlyMap<string, DiagramEdge> = new Map(diagram.edges.map((e) => [e.id, e])),
): (id: string) => number {
  const order = new Map(
    readingOrder(
      diagram.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, ...estimateCardSize(n.label, n.sublabel) })),
      diagram.direction ?? "LR",
    ).map((b, i) => [b.id, i]),
  );
  return (id) => order.get(id) ?? order.get(edges.get(id)?.from ?? "") ?? Infinity;
}

const ranks = new WeakMap<DiagramFile, ReturnType<typeof buildReadingRank>>();

/** Checked snapshots are immutable; switching targets reuses the same small presentation index. */
export function readingRank(diagram: DiagramFile): (id: string) => number {
  let rank = ranks.get(diagram);
  if (!rank) ranks.set(diagram, (rank = buildReadingRank(diagram)));
  return rank;
}
