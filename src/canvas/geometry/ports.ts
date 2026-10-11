// Port spreading: when several edges meet the same side of a node, give each its own attachment
// point along that side, ordered by where the other end sits so the fan doesn't cross itself.

import type { Side } from "../../model/types";
import { centerOf, type Point, type Rect } from "./rect";

export interface PortEnd {
  /** Unique key for this end, e.g. `${edgeId}:s`. */
  key: string;
  node: string;
  side: Side;
  /** Where the edge is heading (the other node's centre); sorts the ends along the side. */
  toward: Point;
  /** Stable tie-breaker (edge id). */
  order: string;
}

/** Gap kept free at each corner of a side, so ports stay clear of the rounded corners. */
const CORNER = 10;

/** Offset of slot `i` of `n` from the side's centre. */
export function slotOffset(i: number, n: number, sideLength: number, spacing: number): number {
  if (n <= 1) return 0;
  const step = Math.min(spacing, Math.max(2, sideLength - 2 * CORNER) / (n - 1));
  return (i - (n - 1) / 2) * step;
}

export function sidePoint(r: Rect, side: Side, offset = 0): Point {
  const c = centerOf(r);
  switch (side) {
    case "top":
      return { x: c.x + offset, y: r.y };
    case "bottom":
      return { x: c.x + offset, y: r.y + r.height };
    case "left":
      return { x: r.x, y: c.y + offset };
    case "right":
      return { x: r.x + r.width, y: c.y + offset };
  }
}

/** Assigns every end a point on its node's side. Ends on the same side are spread `spacing` apart. */
export function spreadPorts(
  ends: readonly PortEnd[],
  rects: ReadonlyMap<string, Rect>,
  spacing = 14,
): Map<string, Point> {
  const groups = new Map<string, PortEnd[]>();
  for (const e of ends) {
    const k = `${e.node}\u0000${e.side}`;
    const g = groups.get(k);
    if (g) g.push(e);
    else groups.set(k, [e]);
  }
  const out = new Map<string, Point>();
  for (const list of groups.values()) {
    const { node, side } = list[0];
    const r = rects.get(node);
    if (!r) continue;
    const vertical = side === "left" || side === "right";
    const c = centerOf(r);
    // Sort along the side by the direction each edge heads in, so neighbours don't cross on the way out.
    // Using the angle (not just the coordinate) keeps edges heading "behind" the side in order too.
    const key = (e: PortEnd) => {
      const dx = e.toward.x - c.x;
      const dy = e.toward.y - c.y;
      return vertical ? dy / (Math.abs(dx) + r.width / 2) : dx / (Math.abs(dy) + r.height / 2);
    };
    const sorted = [...list].sort(
      (a, b) => key(a) - key(b) || (a.order < b.order ? -1 : a.order > b.order ? 1 : a.key < b.key ? -1 : 1),
    );
    const len = vertical ? r.height : r.width;
    sorted.forEach((e, i) => out.set(e.key, sidePoint(r, side, slotOffset(i, sorted.length, len, spacing))));
  }
  return out;
}
