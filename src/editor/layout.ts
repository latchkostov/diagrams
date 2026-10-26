// Cheap layered auto-layout (no deps): longest-path layering with back-edges ignored, a few
// barycenter sweeps to reduce crossings, then a size-aware grid: each column is as wide as its
// widest node plus a gap wide enough for the labels of the edges crossing it, and rows are spaced
// by the tallest node, so nodes never overlap and labels have room between them.

import { estimateCardSize } from "../canvas/nodes/size";
import { pillHeight, pillWidth, wrapLines } from "../canvas/geometry/labels";

export interface LayoutInput {
  /** Size defaults to the card estimate for the label (220 x 72 without one). */
  nodes: { id: string; x: number; y: number; width?: number; height?: number; label?: string; sublabel?: string }[];
  edges: { from: string; to: string; label?: string }[];
  direction?: "LR" | "TB";
}

/** Minimum pitch per direction: `along` between layers, `across` between siblings in a layer. */
export const LAYOUT_GRID = { origin: 40, LR: { along: 360, across: 120 }, TB: { along: 160, across: 280 } } as const;

/** Clear space a label needs between two layers: its pill (wrapped to two lines if long) plus routing room. */
function labelRoom(label: string | undefined, direction: "LR" | "TB"): number {
  const text = label?.trim();
  if (!text) return 0;
  const lines = text.length > 14 ? (wrapLines(text, 2) ?? [text]) : [text];
  const line = lines.reduce((a, b) => (pillWidth(a) > pillWidth(b) ? a : b));
  return direction === "LR" ? pillWidth(line) + 48 : pillHeight(lines.length) + 48;
}

export function layeredLayout({ nodes, edges, direction = "LR" }: LayoutInput): Map<string, { x: number; y: number }> {
  const ids = nodes.map((n) => n.id);
  const known = new Set(ids);
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of edges) if (known.has(e.from) && known.has(e.to) && e.from !== e.to) out.get(e.from)!.push(e.to);

  // Drop back-edges (DFS) so cycles like feedback loops don't stretch the layering.
  const forward = new Map<string, string[]>(ids.map((id) => [id, []]));
  const state = new Map<string, 1 | 2>();
  const visit = (id: string) => {
    state.set(id, 1);
    for (const to of out.get(id)!) {
      if (state.get(to) === 1) continue; // back-edge
      forward.get(id)!.push(to);
      if (!state.has(to)) visit(to);
    }
    state.set(id, 2);
  };
  const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const tos of out.values()) for (const to of tos) indeg.set(to, indeg.get(to)! + 1);
  const primary = (n: { x: number; y: number }) => (direction === "LR" ? n.x : n.y);
  const byPos = [...nodes].sort((a, b) => primary(a) - primary(b));
  for (const n of byPos) if (!state.has(n.id) && indeg.get(n.id) === 0) visit(n.id);
  for (const n of byPos) if (!state.has(n.id)) visit(n.id);

  // Longest path from sources.
  const layer = new Map<string, number>(ids.map((id) => [id, 0]));
  const fIndeg = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const tos of forward.values()) for (const to of tos) fIndeg.set(to, fIndeg.get(to)! + 1);
  const queue = ids.filter((id) => fIndeg.get(id) === 0);
  while (queue.length) {
    const id = queue.shift()!;
    for (const to of forward.get(id)!) {
      layer.set(to, Math.max(layer.get(to)!, layer.get(id)! + 1));
      fIndeg.set(to, fIndeg.get(to)! - 1);
      if (fIndeg.get(to) === 0) queue.push(to);
    }
  }

  // Initial order within a layer: current cross-axis position.
  const cross = new Map(nodes.map((n) => [n.id, direction === "LR" ? n.y : n.x]));
  const layers: string[][] = [];
  for (const id of ids) (layers[layer.get(id)!] ??= []).push(id);
  for (const l of layers) l?.sort((a, b) => cross.get(a)! - cross.get(b)!);

  const preds = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const [from, tos] of forward) for (const to of tos) preds.get(to)!.push(from);
  const index = new Map<string, number>();
  const reindex = () => layers.forEach((l) => l?.forEach((id, i) => index.set(id, i)));
  reindex();
  const bary = (id: string, nbrs: string[]) =>
    nbrs.length ? nbrs.reduce((s, n) => s + index.get(n)!, 0) / nbrs.length : index.get(id)!;
  for (let sweep = 0; sweep < 4; sweep++) {
    const down = sweep % 2 === 0;
    const order = down ? layers.slice(1) : layers.slice(0, -1).reverse();
    for (const l of order) {
      if (!l) continue;
      const score = new Map(l.map((id) => [id, bary(id, down ? preds.get(id)! : forward.get(id)!)]));
      l.sort((a, b) => score.get(a)! - score.get(b)!);
      l.forEach((id, i) => index.set(id, i));
    }
  }

  const tallest = Math.max(...layers.map((l) => l?.length ?? 0));
  const result = new Map<string, { x: number; y: number }>();
  const { origin } = LAYOUT_GRID;
  const grid = LAYOUT_GRID[direction];
  const lr = direction === "LR";
  const size = new Map(
    nodes.map((n) => {
      const est = estimateCardSize(n.label ?? "", n.sublabel);
      return [n.id, { width: n.width ?? est.width, height: n.height ?? est.height }];
    }),
  );
  const alongSize = (id: string) => (lr ? size.get(id)!.width : size.get(id)!.height);
  const acrossSize = (id: string) => (lr ? size.get(id)!.height : size.get(id)!.width);
  // The default 220 x 72 card leaves exactly the classic grid gap; bigger cards and labels widen it.
  const minGap = grid.along - (lr ? 220 : 72);
  const gapAfter = layers.map(() => minGap);
  for (const e of edges) {
    if (!known.has(e.from) || !known.has(e.to)) continue;
    const a = Math.min(layer.get(e.from)!, layer.get(e.to)!);
    const b = Math.max(layer.get(e.from)!, layer.get(e.to)!);
    const room = labelRoom(e.label, direction);
    // A label sits in one of the gaps the edge crosses; reserve it in the first one.
    if (b > a) gapAfter[a] = Math.max(gapAfter[a], room);
  }
  const starts: number[] = [];
  let cursor = origin;
  layers.forEach((l, li) => {
    starts[li] = cursor;
    const thick = Math.max(0, ...(l ?? []).map(alongSize));
    cursor += Math.max(grid.along, thick + gapAfter[li]);
  });
  const pitch = Math.max(grid.across, ...nodes.map((n) => acrossSize(n.id) + (lr ? 48 : 60)));
  layers.forEach((l, li) => {
    l?.forEach((id, i) => {
      const along = starts[li];
      const across = origin + ((tallest - l.length) * pitch) / 2 + i * pitch;
      result.set(
        id,
        direction === "LR"
          ? { x: along, y: Math.round(across / 10) * 10 }
          : { x: Math.round(across / 10) * 10, y: along },
      );
    });
  });
  return result;
}
