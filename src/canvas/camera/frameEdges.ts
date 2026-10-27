import { intersects, segmentHitsRect, type Rect } from "../geometry/rect";
import { pointAlong } from "../geometry/path";
import { nudgeRoutes } from "../geometry/nudge";
import { routeOrthogonal } from "../geometry/orthogonal";

export type FrameEnd = "in" | "pinned" | "out";
export type FrameSide = "left" | "right" | "top" | "bottom";
export type Point = { x: number; y: number };
/** Frame-only lanes use screen pixels, independent of the camera's zoom. */
export function frameLanes(routes: ReadonlyMap<string, Point[]>, blockers: readonly Rect[]) {
  return nudgeRoutes(routes, blockers, { separation: 8, tolerance: 8 });
}
export const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

export function innerFrame(
  width: number,
  height: number,
  _view: "focus" | "follow",
  _dock: boolean,
  _rtl = false,
  phone = false,
): Rect {
  const side = phone ? 8 : 28;
  return { x: side, y: 28, width: Math.max(0, width - side * 2), height: Math.max(0, height - 56) };
}

/** Round 6: endpoint state, rather than stroke emphasis, decides every part of an edge. */
export function edgeInFrame(a: FrameEnd, b: FrameEnd, _near: boolean) {
  const inside = a === "in" || b === "in";
  return {
    draw: inside,
    pill: inside && a !== "out" && b !== "out",
    arrow: a === "in" && b === "in",
    particles: inside,
  };
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

/** A separate bottom row: routes stop at its top, above the reserved legend. */
export function pinRow(inner: Rect, height: number): { routes: Rect; row: Rect; top: Rect } {
  return {
    routes: { ...inner, y: inner.y + height + 12, height: Math.max(0, inner.height - 2 * (height + 12)) },
    row: { ...inner, y: inner.y + inner.height - height, height },
    top: { ...inner, height },
  };
}

/** Retain the route up to its first seam, then join the pin orthogonally.
 * No second, diagonal leader: the connection itself owns its endpoint.
 */
export function routeToPin(
  points: readonly Point[],
  frame: Rect,
  pin: FramePin,
  obstacles: readonly Rect[] = [],
): Point[] {
  const kept: Point[] = [];
  for (const point of points) {
    // A painted card's port can be in the seam reserved around the route
    // area. Keep that first endpoint, then turn inward before joining a pin.
    if (kept.length && !contains(frame, { ...point, width: 0, height: 0 })) break;
    kept.push(point);
  }
  if (!kept.length) return [];
  const anchor = { x: pin.box.x + pin.box.width / 2, y: pin.box.y + pin.box.height / 2 };
  if (pin.side === "left") anchor.x = pin.box.x + pin.box.width;
  if (pin.side === "right") anchor.x = pin.box.x;
  if (pin.side === "top") anchor.y = pin.box.y + pin.box.height;
  if (pin.side === "bottom") anchor.y = pin.box.y;
  if (obstacles.length && points.length > 1) {
    const a = points[0],
      b = points[1];
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const result = routeOrthogonal({
      source: a,
      sourceDir: Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) },
      target: anchor,
      targetDir:
        pin.side === "left"
          ? { x: 1, y: 0 }
          : pin.side === "right"
            ? { x: -1, y: 0 }
            : pin.side === "top"
              ? { x: 0, y: 1 }
              : { x: 0, y: -1 },
      obstacles,
      pad: 8,
      stub: 16,
    });
    if (result.ok) return result.points;
  }
  const last = kept.at(-1)!;
  // Turn above the bottom row rather than running a trunk through other pins.
  if (pin.side === "bottom")
    return [...kept, { x: last.x, y: frame.y + frame.height }, { x: anchor.x, y: frame.y + frame.height }, anchor];
  if (pin.side === "top") return [...kept, { x: last.x, y: frame.y }, { x: anchor.x, y: frame.y }, anchor];
  return [
    ...kept,
    pin.side === "left" || pin.side === "right" ? { x: anchor.x, y: last.y } : { x: last.x, y: anchor.y },
    anchor,
  ];
}

/** Unretained neighbours stop before the pin rows instead of crossing them. */
export function clipFrameRoute(points: readonly Point[], frame: Rect): Point[] {
  if (!points.length) return [];
  const kept = [points[0]];
  for (const point of points.slice(1)) {
    if (!contains(frame, { ...point, width: 0, height: 0 })) {
      const crossing = frameCrossing([kept.at(-1)!, point], frame);
      if (crossing) kept.push(crossing.point);
      break;
    }
    kept.push(point);
  }
  return kept;
}

/** Use the larger text only when its entire ink box has a collision-free home. */
export function placeTextFloor(
  box: Rect,
  inner: Rect,
  blockers: readonly Rect[],
  paths: readonly (readonly Point[])[] = [],
  ownPath?: readonly Point[],
): Rect | null {
  const clear = (candidate: Rect) =>
    clearFrameBox(candidate, inner, blockers) &&
    !paths.some((points) => points.some((b, i) => i > 0 && segmentHitsRect(points[i - 1], b, candidate)));
  if (clear(box)) return box;
  if (!ownPath?.length) return null;
  return placeFrameLabel(box, ownPath, inner, blockers, clear);
}

/** Slide along the edge itself; never move authored data or jump a label onto another route. */
export function placeFrameLabel(
  box: Rect,
  points: readonly Point[],
  inner: Rect,
  blockers: readonly Rect[],
  accept: (box: Rect) => boolean = () => true,
): Rect | null {
  const clear = (r: Rect) => clearFrameBox(r, inner, blockers) && accept(r);
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

/** Intersect the pane with the docked surfaces, all measured in screen pixels. */
export function fitRectangle(
  pane: Rect,
  limits: { left?: number; top?: number; right?: number; bottom?: number },
): Rect {
  const x = Math.max(pane.x, limits.left ?? pane.x);
  const y = Math.max(pane.y, limits.top ?? pane.y);
  return {
    x,
    y,
    width: Math.max(0, Math.min(pane.x + pane.width, limits.right ?? Infinity) - x),
    height: Math.max(0, Math.min(pane.y + pane.height, limits.bottom ?? Infinity) - y),
  };
}

export function visibleCanvas(root: HTMLElement): Rect {
  const pane = root.getBoundingClientRect();
  const doc = root.ownerDocument;
  const rect = (id: string) => doc?.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect();
  const rail = rect("tool-rail"),
    dock = rect("inspector"),
    bezel = rect("canvas-bezel");
  const legend = rect("live-route-legend");
  const paneRight = pane.left + root.clientWidth;
  const paneBottom = pane.top + root.clientHeight;
  const limits = {
    left: pane.left,
    right: paneRight,
    top: bezel && bezel.top <= pane.top && bezel.bottom > pane.top ? bezel.bottom : pane.top,
    bottom: Math.min(paneBottom, legend?.top ?? paneBottom),
  };
  // Remove each surface from the edge it actually occludes, choosing the smallest
  // crop. A full-width phone sheet belongs to the bottom even at its full snap;
  // it must never be mistaken for both side docks. Outside surfaces cost nothing.
  for (const r of [rail, dock]) {
    if (!r || r.right <= pane.left || r.left >= paneRight || r.bottom <= pane.top || r.top >= paneBottom) continue;
    const cuts = [
      { side: "bottom", touches: r.bottom >= paneBottom, depth: (paneBottom - r.top) / root.clientHeight },
      { side: "top", touches: r.top <= pane.top, depth: (r.bottom - pane.top) / root.clientHeight },
      { side: "left", touches: r.left <= pane.left, depth: (r.right - pane.left) / root.clientWidth },
      { side: "right", touches: r.right >= paneRight, depth: (paneRight - r.left) / root.clientWidth },
    ] as const;
    const cut = cuts.filter((c) => c.touches).sort((a, b) => a.depth - b.depth)[0];
    if (cut?.side === "bottom") limits.bottom = Math.min(limits.bottom, r.top);
    if (cut?.side === "top") limits.top = Math.max(limits.top, r.bottom);
    if (cut?.side === "left") limits.left = Math.max(limits.left, r.right);
    if (cut?.side === "right") limits.right = Math.min(limits.right, r.left);
  }
  const frame = fitRectangle({ x: pane.left, y: pane.top, width: root.clientWidth, height: root.clientHeight }, limits);
  return { ...frame, x: frame.x - pane.left, y: frame.y - pane.top };
}
