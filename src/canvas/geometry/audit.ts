// Overlap audit: given what's on the canvas (node boxes, label boxes, edge polylines, group
// headers), list everything that overlaps when it shouldn't. Pure, so it runs in unit tests,
// the Lab's "Overlap audit" preset and anywhere else a layout needs checking.

import { intersects, segmentHitsRect, type Point, type Rect } from "./rect";
import { SpatialGrid } from "./spatial";

export type ViolationKind =
  "node-node" | "label-node" | "label-label" | "label-header" | "edge-node" | "header-node" | "edge-overlap";

export interface Violation {
  kind: ViolationKind;
  /** Ids involved: node / edge / group ids (labels use their edge id). */
  a: string;
  b: string;
  /** Where to draw the highlight. */
  at: Rect;
}

export interface AuditInput {
  nodes: readonly { id: string; rect: Rect }[];
  labels?: readonly { id: string; rect: Rect }[];
  edges?: readonly { id: string; source: string; target: string; points: readonly Point[] }[];
  groups?: readonly { id: string; header: Rect }[];
}

export interface AuditOptions {
  /** Overlaps thinner than this (px) are ignored: sub-pixel touching isn't a violation. */
  tolerance?: number;
  /** Parallel segments of different edges closer than this count as drawn on top of each other. */
  minSeparation?: number;
}

function overlapRect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x),
    y = Math.max(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y),
  };
}

const segBox = (a: Point, b: Point): Rect => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  width: Math.abs(a.x - b.x),
  height: Math.abs(a.y - b.y),
});

export function auditLayout(input: AuditInput, opts: AuditOptions = {}): Violation[] {
  const tol = opts.tolerance ?? 0.5;
  const minSep = opts.minSeparation ?? 3;
  const out: Violation[] = [];
  const nodes = input.nodes;
  const labels = input.labels ?? [];
  const grid = new SpatialGrid<{ id: string; rect: Rect }>(200);
  for (const n of nodes) grid.insert(n.rect, n);

  const pairs = <T extends { id: string; rect: Rect }>(list: readonly T[], kind: ViolationKind) => {
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++)
        if (intersects(list[i].rect, list[j].rect, tol))
          out.push({ kind, a: list[i].id, b: list[j].id, at: overlapRect(list[i].rect, list[j].rect) });
  };
  pairs(nodes, "node-node");
  pairs(labels, "label-label");

  for (const l of labels)
    for (const { item: n } of grid.query(l.rect))
      if (intersects(l.rect, n.rect, tol))
        out.push({ kind: "label-node", a: l.id, b: n.id, at: overlapRect(l.rect, n.rect) });

  for (const g of input.groups ?? []) {
    for (const { item: n } of grid.query(g.header))
      if (intersects(g.header, n.rect, tol))
        out.push({ kind: "header-node", a: g.id, b: n.id, at: overlapRect(g.header, n.rect) });
    for (const l of labels)
      if (intersects(g.header, l.rect, tol))
        out.push({ kind: "label-header", a: l.id, b: g.id, at: overlapRect(g.header, l.rect) });
  }

  const edges = input.edges ?? [];
  for (const e of edges) {
    const hit = new Set<string>();
    for (let i = 1; i < e.points.length; i++) {
      const a = e.points[i - 1],
        b = e.points[i];
      for (const { item: n } of grid.query(segBox(a, b))) {
        if (n.id === e.source || n.id === e.target || hit.has(n.id)) continue;
        if (segmentHitsRect(a, b, n.rect, Math.max(tol, 1))) {
          hit.add(n.id);
          out.push({ kind: "edge-node", a: e.id, b: n.id, at: n.rect });
        }
      }
    }
  }

  // Axis-aligned segments of different edges lying on top of each other.
  type S = { edge: string; vertical: boolean; c: number; lo: number; hi: number };
  const segs: S[] = [];
  for (const e of edges)
    for (let i = 1; i < e.points.length; i++) {
      const a = e.points[i - 1],
        b = e.points[i];
      if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) > 0.5)
        segs.push({ edge: e.id, vertical: true, c: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) });
      else if (Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) > 0.5)
        segs.push({ edge: e.id, vertical: false, c: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) });
    }
  segs.sort((a, b) => Number(a.vertical) - Number(b.vertical) || a.c - b.c);
  const reported = new Set<string>();
  for (let i = 0; i < segs.length; i++)
    for (
      let j = i + 1;
      j < segs.length && segs[j].vertical === segs[i].vertical && segs[j].c - segs[i].c < minSep;
      j++
    ) {
      const a = segs[i],
        b = segs[j];
      if (a.edge === b.edge) continue;
      const lo = Math.max(a.lo, b.lo),
        hi = Math.min(a.hi, b.hi);
      // Shorter shared runs sit inside the rounded corners (radius 10), so they don't read as one line.
      if (hi - lo < 8) continue;
      const k = a.edge < b.edge ? `${a.edge}|${b.edge}` : `${b.edge}|${a.edge}`;
      if (reported.has(k)) continue;
      reported.add(k);
      const at = a.vertical
        ? { x: a.c - 3, y: lo, width: 6, height: hi - lo }
        : { x: lo, y: a.c - 3, width: hi - lo, height: 6 };
      out.push({
        kind: "edge-overlap",
        a: a.edge < b.edge ? a.edge : b.edge,
        b: a.edge < b.edge ? b.edge : a.edge,
        at,
      });
    }
  return out;
}

/** Violation counts per kind (handy for reports and assertions). */
export function countViolations(v: readonly Violation[]): Record<ViolationKind, number> {
  const c: Record<ViolationKind, number> = {
    "node-node": 0,
    "label-node": 0,
    "label-label": 0,
    "label-header": 0,
    "edge-node": 0,
    "header-node": 0,
    "edge-overlap": 0,
  };
  for (const x of v) c[x.kind]++;
  return c;
}
