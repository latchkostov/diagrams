// Workload: the public examples (docs/BENCHMARKS.md § Workloads), as they ship, and tiled into one big diagram of
// exactly `n` nodes: real stencils, labels, props, groups and routing filters, at scale. Only src/examples/*.json:
// the glob doesn't descend into src/examples/private, which benchmarks never read.

import type { DiagramEdge, DiagramFile, DiagramGroup, DiagramNode } from "../../model/types";
import { blockGrid, bounds } from "./common";

const files = import.meta.glob<DiagramFile>("../../examples/*.json", { eager: true, import: "default" });

/** The public examples by slug, in file-name order. Deep copies: callers may change them. */
export function publicExamples(): { slug: string; diagram: DiagramFile }[] {
  return Object.entries(files)
    .map(([path, diagram]) => ({
      slug: path.slice(path.lastIndexOf("/") + 1, -".json".length),
      diagram: diagram as DiagramFile,
    }))
    .filter(({ slug }) => !slug.includes("private"))
    .sort((a, b) => (a.slug < b.slug ? -1 : 1))
    .map(({ slug, diagram }) => ({ slug, diagram: structuredClone(diagram) }));
}

/**
 * Copies of the public (legacy, v1) examples, in turn, on a grid, ids prefixed per copy, until there are exactly `n` nodes (the
 * last copy cut short: its edges to nodes left out go too). Saved simulations are dropped: they name the original ids.
 */
export function tiledExamples(n: number): DiagramFile {
  // The legacy (diagrams/v1) examples: a v2 example carries a planning model of its own (P3, autoscaling, shared
  // quotas with document-wide ids) that one tiled document can't hold for every copy.
  const sources = publicExamples()
    .map(({ diagram }) => diagram)
    .filter((d) => !d.planning);
  const perCopy = sources.reduce((sum, d) => sum + d.nodes.length, 0) / sources.length;
  const grid = blockGrid(Math.ceil(n / perCopy) + sources.length);
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  const groups: DiagramGroup[] = [];
  const pitch = { x: 0, y: 0 };
  for (const d of sources) {
    const box = bounds([
      ...d.nodes,
      ...(d.groups ?? []).map((g) => ({ x: g.x + g.width - 220, y: g.y + g.height - 72 })),
    ]);
    pitch.x = Math.max(pitch.x, box.width + 300);
    pitch.y = Math.max(pitch.y, box.height + 300);
  }
  for (let copy = 0; nodes.length < n; copy++) {
    const src = sources[copy % sources.length];
    const [gx, gy] = grid[copy];
    const origin = bounds([...src.nodes, ...(src.groups ?? [])]);
    const dx = gx * pitch.x - origin.x;
    const dy = gy * pitch.y - origin.y;
    const p = `c${copy + 1}-`;
    const kept = new Set<string>();
    for (const node of src.nodes) {
      if (nodes.length >= n) break;
      kept.add(node.id);
      nodes.push({
        ...structuredClone(node),
        id: p + node.id,
        x: node.x + dx,
        y: node.y + dy,
        ...(node.group ? { group: p + node.group } : {}),
      });
    }
    for (const e of src.edges)
      if (kept.has(e.from) && kept.has(e.to))
        edges.push({ ...structuredClone(e), id: p + e.id, from: p + e.from, to: p + e.to });
    const used = new Set(src.nodes.filter((x) => kept.has(x.id)).map((x) => x.group));
    for (const g of src.groups ?? [])
      if (used.has(g.id))
        groups.push({ ...g, id: p + g.id, x: g.x + dx, y: g.y + dy, label: `${g.label} (${copy + 1})` });
  }
  return {
    format: "diagrams/v1",
    title: `Public examples, tiled (${n} nodes)`,
    description: "Benchmark workload: copies of the public examples on a grid.",
    direction: "LR",
    groups,
    nodes,
    edges,
  };
}
