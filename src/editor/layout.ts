// Cheap layered auto-layout (no deps): longest-path layering with back-edges ignored, a few
// barycenter sweeps to reduce crossings, then a column grid matching the examples' convention.

export interface LayoutInput {
  nodes: { id: string; x: number; y: number }[];
  edges: { from: string; to: string }[];
  direction?: "LR" | "TB";
}

/** Spacing per direction: `along` between layers, `across` between siblings in a layer. */
export const LAYOUT_GRID = { origin: 40, LR: { along: 360, across: 120 }, TB: { along: 160, across: 280 } } as const;

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
  const bary = (id: string, nbrs: string[]) => (nbrs.length ? nbrs.reduce((s, n) => s + index.get(n)!, 0) / nbrs.length : index.get(id)!);
  for (let sweep = 0; sweep < 4; sweep++) {
    const down = sweep % 2 === 0;
    const order = down ? layers.slice(1) : layers.slice(0, -1).reverse();
    for (const l of order) {
      if (!l) continue;
      const score = new Map(l.map((id) => [id, bary(id, down ? preds.get(id)! : forward.get(id)!)]));
      l.sort((a, b) => score.get(a)! - score.get(b)!);
      reindex();
    }
  }

  const tallest = Math.max(...layers.map((l) => l?.length ?? 0));
  const result = new Map<string, { x: number; y: number }>();
  const { origin } = LAYOUT_GRID;
  const gap = LAYOUT_GRID[direction];
  layers.forEach((l, li) => {
    l?.forEach((id, i) => {
      const along = origin + li * gap.along;
      const across = origin + ((tallest - l.length) * gap.across) / 2 + i * gap.across;
      result.set(id, direction === "LR" ? { x: along, y: Math.round(across / 10) * 10 } : { x: Math.round(across / 10) * 10, y: along });
    });
  });
  return result;
}
