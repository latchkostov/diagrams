// Shared pieces of the benchmark workloads (docs/BENCHMARKS.md § Workloads): a seeded PRNG, node and edge builders
// and boundary boxes. Pure functions: no DOM, no Node APIs, no clock, no Math.random. The same seed always gives the
// same diagram, byte for byte, so a benchmark run measures the code, never a different input.

import { prng } from "../../lab/generators";
import type { DiagramEdge, DiagramFile, DiagramGroup, DiagramNode } from "../../model/types";

export { prng };

/** A seeded random source with the helpers the generators use. */
export interface Rand {
  /** Uniform in [0, 1). */
  next(): number;
  /** An integer in [min, max]. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;
}

export function rand(seed: number): Rand {
  const next = prng(seed);
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)],
    chance: (p) => next() < p,
  };
}

/** Card size the canvas draws (docs/PLAN.md): 220 × 72, so boxes leave room around it. */
export const CARD = { width: 220, height: 72 } as const;

/** A diagram under construction: ids are unique, edges are deduplicated by (from, to). */
export class Builder {
  readonly nodes: DiagramNode[] = [];
  readonly edges: DiagramEdge[] = [];
  readonly groups: DiagramGroup[] = [];
  private readonly pairs = new Set<string>();
  private readonly ids = new Set<string>();

  node(n: DiagramNode): DiagramNode {
    if (this.ids.has(n.id)) throw new Error(`duplicate node id ${n.id}`);
    this.ids.add(n.id);
    this.nodes.push(n);
    return n;
  }

  /** Adds `from → to` once; a second edge between the same pair (either props) is skipped. */
  edge(from: DiagramNode, to: DiagramNode, e: Omit<DiagramEdge, "id" | "from" | "to"> = {}): DiagramEdge | undefined {
    const key = `${from.id}>${to.id}`;
    if (from.id === to.id || this.pairs.has(key)) return undefined;
    this.pairs.add(key);
    const edge: DiagramEdge = { id: `e${this.edges.length + 1}`, from: from.id, to: to.id, ...e };
    this.edges.push(edge);
    return edge;
  }

  /** A boundary around `members` (absolute positions), with room for its header. Sets each member's group. */
  group(id: string, label: string, members: DiagramNode[], tone: DiagramGroup["tone"]): DiagramGroup | undefined {
    if (!members.length) return undefined;
    const box = bounds(members);
    for (const m of members) m.group = id;
    const g: DiagramGroup = {
      id,
      label,
      tone,
      x: box.x - 40,
      y: box.y - 56,
      width: box.width + 80,
      height: box.height + 96,
    };
    this.groups.push(g);
    return g;
  }

  file(title: string, description: string, extra: Partial<DiagramFile> = {}): DiagramFile {
    return {
      format: "diagrams/v1",
      title,
      description,
      direction: "LR",
      ...extra,
      ...(this.groups.length ? { groups: this.groups } : {}),
      nodes: this.nodes,
      edges: this.edges,
    };
  }
}

/** The box around some cards (each CARD-sized at its top-left x, y). */
export function bounds(nodes: readonly { x: number; y: number }[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const n of nodes) {
    x0 = Math.min(x0, n.x);
    y0 = Math.min(y0, n.y);
    x1 = Math.max(x1, n.x + CARD.width);
    y1 = Math.max(y1, n.y + CARD.height);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Splits `total` into `parts` near-equal integers that add up to it (the first ones larger). */
export function split(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  const extra = total - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0));
}

/** Cells of a near-square grid of `count` blocks, wider than tall: [column, row] per block. */
export function blockGrid(count: number, aspect = 1.6): [number, number][] {
  const cols = Math.max(1, Math.round(Math.sqrt(count * aspect)));
  return Array.from({ length: count }, (_, i) => [i % cols, Math.floor(i / cols)]);
}

/** Simple stable 32-bit FNV-1a hash of a string: a workload's fingerprint in results. */
export function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
