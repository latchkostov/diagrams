import { Position } from "@xyflow/react";
import type { Side } from "../../model/types";

// Floating edge routing: when an edge doesn't pin its sides, pick them from where the two
// nodes sit relative to each other, so back-edges and vertical stacks don't loop around.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface XY {
  x: number;
  y: number;
}

export const SIDES: readonly Side[] = ["top", "right", "bottom", "left"];

export const sidePosition: Record<Side, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

/** Boxes closer than this along an axis count as overlapping on it. */
const MIN_GAP = 24;
/** The primary axis wins unless the other axis' gap is this many times larger. */
const PRIMARY_BIAS = 3;

const cx = (r: Rect) => r.x + r.width / 2;
const cy = (r: Rect) => r.y + r.height / 2;

/** Gap between two boxes along x and y (negative when they overlap on that axis). */
export function gaps(a: Rect, b: Rect): { h: number; v: number } {
  return {
    h: Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width)),
    v: Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height)),
  };
}

/** Centre of a box side. */
export function sideCenter(r: Rect, side: Side): XY {
  switch (side) {
    case "top":
      return { x: cx(r), y: r.y };
    case "bottom":
      return { x: cx(r), y: r.y + r.height };
    case "left":
      return { x: r.x, y: cy(r) };
    case "right":
      return { x: r.x + r.width, y: cy(r) };
  }
}

/** The side of `r` that faces `p` (used when only the other end of an edge is pinned). */
export function facingSide(r: Rect, p: XY): Side {
  const gx = p.x < r.x ? r.x - p.x : p.x > r.x + r.width ? p.x - (r.x + r.width) : -1;
  const gy = p.y < r.y ? r.y - p.y : p.y > r.y + r.height ? p.y - (r.y + r.height) : -1;
  if (gx < 0 && gy < 0) {
    // Inside the box: leave through the nearest edge.
    const d = { left: p.x - r.x, right: r.x + r.width - p.x, top: p.y - r.y, bottom: r.y + r.height - p.y };
    return (Object.keys(d) as Side[]).reduce((a, b) => (d[b] < d[a] ? b : a));
  }
  if (gx >= gy) return p.x < r.x ? "left" : "right";
  return p.y < r.y ? "top" : "bottom";
}

/**
 * Chooses attachment sides for an edge from `s` to `t`. Pinned sides are kept; the rest follow
 * the geometry, preferring the diagram's flow axis:
 * - clearly side by side → right→left (or left→right for back-edges, which then run straight),
 * - stacked → bottom→top (or top→bottom when the target is above),
 * - overlapping boxes → whichever axis the centres differ most on.
 */
export function pickSides(
  s: Rect,
  t: Rect,
  opts: { direction?: "LR" | "TB"; sourceSide?: Side; targetSide?: Side } = {},
): { sourceSide: Side; targetSide: Side } {
  const { sourceSide, targetSide } = opts;
  if (sourceSide && targetSide) return { sourceSide, targetSide };
  if (sourceSide) return { sourceSide, targetSide: facingSide(t, sideCenter(s, sourceSide)) };
  if (targetSide) return { sourceSide: facingSide(s, sideCenter(t, targetSide)), targetSide };

  const g = gaps(s, t);
  const dx = cx(t) - cx(s);
  const dy = cy(t) - cy(s);
  const horizontal = (): { sourceSide: Side; targetSide: Side } =>
    dx >= 0 ? { sourceSide: "right", targetSide: "left" } : { sourceSide: "left", targetSide: "right" };
  const vertical = (): { sourceSide: Side; targetSide: Side } =>
    dy >= 0 ? { sourceSide: "bottom", targetSide: "top" } : { sourceSide: "top", targetSide: "bottom" };

  if ((opts.direction ?? "LR") === "LR") {
    if (g.h >= MIN_GAP && g.v <= g.h * PRIMARY_BIAS) return horizontal();
    if (g.v >= MIN_GAP) return vertical();
    if (g.h >= MIN_GAP) return horizontal();
  } else {
    if (g.v >= MIN_GAP && g.h <= g.v * PRIMARY_BIAS) return vertical();
    if (g.h >= MIN_GAP) return horizontal();
    if (g.v >= MIN_GAP) return vertical();
  }
  // Overlapping: compare centre offsets relative to box size.
  const nx = Math.abs(dx) / Math.max(1, (s.width + t.width) / 2);
  const ny = Math.abs(dy) / Math.max(1, (s.height + t.height) / 2);
  return nx >= ny ? horizontal() : vertical();
}

/**
 * Perpendicular nudge for an edge that has a reverse twin (A→B and B→A), so the pair reads as
 * two lanes instead of one overlapping line. Each direction drifts to its own side.
 */
export function laneOffset(sourceSide: Side, targetSide: Side, amount = 7): XY {
  const axisH = (sourceSide === "left" || sourceSide === "right") && (targetSide === "left" || targetSide === "right");
  const axisV = (sourceSide === "top" || sourceSide === "bottom") && (targetSide === "top" || targetSide === "bottom");
  if (axisH) return { x: 0, y: sourceSide === "right" ? -amount : amount };
  if (axisV) return { x: sourceSide === "bottom" ? amount : -amount, y: 0 };
  return { x: 0, y: 0 };
}
