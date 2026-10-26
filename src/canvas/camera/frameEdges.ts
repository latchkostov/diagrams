import { intersects, type Rect } from "../geometry/rect";
import { pointAlong } from "../geometry/path";

export type FrameEnd = "in" | "pinned" | "out";
export type FrameSide = "left" | "right" | "top" | "bottom";
export type Point = { x: number; y: number };
export const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

export function innerFrame(width: number, height: number, view: "focus" | "follow", dock: boolean, rtl = false): Rect {
  if (view === "follow") return { x: 28, y: 28, width: Math.max(0, width - 56), height: Math.max(0, height - 56) };
  return { x: dock && rtl ? 40 : 0, y: 0, width: Math.max(0, width - (dock ? 40 : 0)), height };
}

/** Round 6: endpoint state, rather than stroke emphasis, decides every part of an edge. */
export function edgeInFrame(a: FrameEnd, b: FrameEnd, near: boolean) {
  const inside = a === "in" || b === "in";
  return { draw: inside || near, pill: inside, arrow: a === "in" && b === "in", particles: inside || near };
}

export function cullLabel(box: Rect, frame: Rect, inner: Rect): boolean {
  if (!contains(frame, box)) return true;
  const w = Math.max(0, Math.min(box.x + box.width, inner.x + inner.width) - Math.max(box.x, inner.x));
  const h = Math.max(0, Math.min(box.y + box.height, inner.y + inner.height) - Math.max(box.y, inner.y));
  return w * h < (box.width * box.height) / 2;
}

/** The first place a path from a painted node crosses the inner frame. */
export function frameCrossing(
  points: readonly Point[],
  frame: Rect,
  extendEnd = false,
): { point: Point; side: FrameSide } | null {
  if (extendEnd && points.length > 1) {
    const end = points.at(-1)!;
    const before = points.at(-2)!;
    const length = Math.hypot(end.x - before.x, end.y - before.y);
    if (length) {
      const distance = (2 * Math.max(frame.width, frame.height)) / length;
      points = [...points, { x: end.x + (end.x - before.x) * distance, y: end.y + (end.y - before.y) * distance }];
    }
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    const candidates: { t: number; point: Point; side: FrameSide }[] = [];
    for (const [side, axis, value] of [
      ["left", "x", frame.x],
      ["right", "x", frame.x + frame.width],
      ["top", "y", frame.y],
      ["bottom", "y", frame.y + frame.height],
    ] as const) {
      const delta = b[axis] - a[axis];
      if (!delta) continue;
      const t = (value - a[axis]) / delta;
      if (t < 0 || t > 1) continue;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (
        p.x >= frame.x - 0.01 &&
        p.x <= frame.x + frame.width + 0.01 &&
        p.y >= frame.y - 0.01 &&
        p.y <= frame.y + frame.height + 0.01
      )
        candidates.push({ t, point: p, side });
    }
    if (candidates.length) {
      const { point, side } = candidates.sort((l, r) => l.t - r.t)[0];
      return { point, side };
    }
  }
  return null;
}

export interface FramePin {
  id: string;
  name: string;
  side: FrameSide;
  crossing: Point;
  width: number;
  spotlit: boolean;
  box: Rect;
}
/** Pins and edge labels share the same occupied screen rectangles. */
function clearFrameBox(box: Rect, inner: Rect, blockers: readonly Rect[]): boolean {
  return contains(inner, box) && !blockers.some((block) => intersects(box, block));
}

export function stackPins(
  pins: readonly Omit<FramePin, "box">[],
  inner: Rect,
  height = 28,
  blockers: readonly Rect[] = [],
): FramePin[] {
  const placed: FramePin[] = [];
  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
  for (const pin of pins) {
    const width = Math.min(pin.width, inner.width);
    let x = clamp(pin.crossing.x - width / 2, inner.x, inner.x + inner.width - width);
    let y = clamp(pin.crossing.y - height / 2, inner.y, inner.y + inner.height - height);
    if (pin.side === "left") x = inner.x;
    if (pin.side === "right") x = inner.x + inner.width - width;
    if (pin.side === "top") y = inner.y;
    if (pin.side === "bottom") y = inner.y + inner.height - height;
    const vertical = pin.side === "left" || pin.side === "right";
    const inward =
      pin.side === "top" ? 1 : pin.side === "bottom" ? -1 : y + height / 2 < inner.y + inner.height / 2 ? 1 : -1;
    const occupied = [...blockers, ...placed.map((p) => p.box)];
    // Try the crossing first, then the closest clear spaces along that frame side.
    // Horizontal sides can also stack inward when their whole row is occupied.
    const along = vertical ? "y" : "x";
    const extent = vertical ? height : width;
    const positions = [
      vertical ? y : x,
      inner[along],
      inner[along] + (vertical ? inner.height : inner.width) - extent,
      ...occupied.flatMap((b) => [b[along] - extent - 6, b[along] + (vertical ? b.height : b.width) + 6]),
    ].sort(
      (a, b) =>
        (vertical ? Number((a - y) * inward < 0) - Number((b - y) * inward < 0) : 0) ||
        Math.abs(a - (vertical ? y : x)) - Math.abs(b - (vertical ? y : x)) ||
        (a - b) * -inward,
    );
    const rows = vertical ? 0 : Math.ceil(inner.height / (height + 6));
    let box: Rect | undefined;
    for (let row = 0; row <= rows && !box; row++)
      for (const position of positions) {
        const candidate = { x, y: y + row * (height + 6) * inward, width, height, [along]: position };
        if (clearFrameBox(candidate, inner, occupied)) {
          box = candidate;
          break;
        }
      }
    // An overfull frame must never paint a pin over a card.
    if (box) placed.push({ ...pin, box });
  }
  return placed;
}

/** Slide along the edge itself; never move authored data or jump a label onto another route. */
export function placeFrameLabel(
  box: Rect,
  points: readonly Point[],
  inner: Rect,
  blockers: readonly Rect[],
): Rect | null {
  const clear = (r: Rect) => clearFrameBox(r, inner, blockers);
  if (clear(box)) return box;
  const cx = box.x + box.width / 2,
    cy = box.y + box.height / 2;
  const candidates = Array.from({ length: 15 }, (_, i) => {
    const p = pointAlong(points, 0.15 + i * 0.05).point;
    return {
      x: p.x - box.width / 2,
      y: p.y - box.height / 2,
      width: box.width,
      height: box.height,
      distance: (p.x - cx) ** 2 + (p.y - cy) ** 2,
    };
  }).sort((a, b) => a.distance - b.distance);
  return candidates.find(clear) ?? null;
}

export function oneHop(edges: readonly { source: string; target: string }[], ids: ReadonlySet<string>): Set<string> {
  const near = new Set(ids);
  for (const edge of edges)
    if (ids.has(edge.source) || ids.has(edge.target)) {
      near.add(edge.source);
      near.add(edge.target);
    }
  return near;
}
