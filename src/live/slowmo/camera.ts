// Slow motion's camera, as pure geometry: fit the whole path once and stay put; follow only when
// the path can't be read at that zoom, and then only between hops. See docs/SIMULATION.md.

import { fitAvoiding } from "../../canvas/geometry/fit";

export interface FlowBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface View {
  x: number;
  y: number;
  zoom: number;
}

/** Below this fitted zoom labels are under ~11 px: follow the message instead. */
export const FOLLOW_BELOW = 0.55;
/** Following frames the frontier at this zoom. */
export const FOLLOW_ZOOM = 0.8;
export const MAX_ZOOM = 1.25;
/** Fitting the path, and panning while following (ms). */
export const FIT_MS = 900;
export const PAN_MS = 700;

export function union(boxes: readonly FlowBox[]): FlowBox | null {
  if (!boxes.length) return null;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.width);
    y1 = Math.max(y1, b.y + b.height);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** The view that shows `box` centred in the pane inside `insets`, at `zoom` (or the zoom that fits). */
export function frame(box: FlowBox, pane: { width: number; height: number }, insets: Insets, zoom?: number): View {
  const w = Math.max(1, pane.width - insets.left - insets.right);
  const h = Math.max(1, pane.height - insets.top - insets.bottom);
  const z = zoom ?? Math.min(MAX_ZOOM, w / Math.max(1, box.width), h / Math.max(1, box.height));
  return {
    zoom: z,
    x: insets.left + (w - box.width * z) / 2 - box.x * z,
    y: insets.top + (h - box.height * z) / 2 - box.y * z,
  };
}

export interface CameraPlan {
  mode: "fit" | "follow";
  /** The view for the start of the take. */
  view: View;
  /** The zoom hops are paced for (on-screen edge lengths). */
  zoom: number;
}

/** True when no box in \`items\` sits under any overlay (screen px, relative to the pane) at view \`v\`. */
function clearOf(items: readonly FlowBox[], v: View, overlays: readonly FlowBox[]): boolean {
  return !items.some((b) => {
    const x = b.x * v.zoom + v.x;
    const y = b.y * v.zoom + v.y;
    const w = b.width * v.zoom;
    const h = b.height * v.zoom;
    return overlays.some((o) => x < o.x + o.width && o.x < x + w && y < o.y + o.height && o.y < y + h);
  });
}

/**
 * Fit the path, keeping clear of \`overlays\` (the trace card's first rows: a wide path moves down
 * rather than shrinking, as in a trace). If that's too small to read, or can't keep the path clear of
 * the card, follow from the first node at a readable zoom; \`still\` (reduced motion) always fits, so
 * the camera never moves after it.
 */
export function planCamera(
  path: readonly FlowBox[],
  first: readonly FlowBox[],
  pane: { width: number; height: number },
  insets: Insets,
  overlays: readonly FlowBox[] = [],
  still = false,
): CameraPlan | null {
  const all = union(path);
  if (!all) return null;
  const fit =
    fitAvoiding(path, pane, overlays, { margin: 0, gap: 16, maxZoom: MAX_ZOOM, insets }) ?? frame(all, pane, insets);
  // A fit that leaves path nodes under the card is no fit: the camera would sit still with a hop hidden.
  if (still || (fit.zoom >= FOLLOW_BELOW && clearOf(path, fit, overlays)))
    return { mode: "fit", view: fit, zoom: fit.zoom };
  const start = union(first) ?? all;
  const view =
    fitAvoiding(first.length ? first : path, pane, overlays, {
      margin: 0,
      gap: 16,
      minZoom: FOLLOW_ZOOM,
      maxZoom: FOLLOW_ZOOM,
      insets,
    }) ?? frame(start, pane, insets, FOLLOW_ZOOM);
  return { mode: "follow", view, zoom: FOLLOW_ZOOM };
}

/**
 * Following: where to pan so the frontier (nodes in play and where dots are going) is in view and
 * clear of \`overlays\` (the trace card's first rows), or null when it already is (with a margin).
 * The zoom never changes while following.
 */
export function followPan(
  frontier: readonly FlowBox[],
  current: View,
  pane: { width: number; height: number },
  insets: Insets,
  overlays: readonly FlowBox[] = [],
  margin = 32,
  /** The part of the frontier that matters most (the node at work, the next targets). */
  focus: readonly FlowBox[] = [],
): View | null {
  const box = union(frontier);
  if (!box) return null;
  const z = current.zoom;
  const screen = { x: box.x * z + current.x, y: box.y * z + current.y, width: box.width * z, height: box.height * z };
  const inside =
    screen.x >= insets.left + margin &&
    screen.y >= insets.top + margin &&
    screen.x + screen.width <= pane.width - insets.right - margin &&
    screen.y + screen.height <= pane.height - insets.bottom - margin &&
    !overlays.some(
      (o) =>
        screen.x < o.x + o.width &&
        o.x < screen.x + screen.width &&
        screen.y < o.y + o.height &&
        o.y < screen.y + screen.height,
    );
  if (inside) return null;
  const fit = (items: readonly FlowBox[]) =>
    fitAvoiding(items, pane, overlays, { margin: 0, gap: 16, minZoom: z, maxZoom: z, insets });
  // A fan-out can be too wide to keep beside the card at this zoom: then keep \`focus\` clear of it, or
  // failing that its first node, rather than centring the frontier with the node at work under the card.
  for (const items of [frontier, focus, ...focus.map((f) => [f])]) {
    if (!items.length) continue;
    const v = fit(items);
    if (v && clearOf(items, v, overlays)) return v;
  }
  return fit(frontier) ?? frame(box, pane, insets, z);
}
