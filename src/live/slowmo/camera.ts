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

/**
 * Fit the path, keeping clear of `overlays` (the trace card's first rows: a wide path moves down
 * rather than shrinking, as in a trace). If that's too small to read, follow from the first node
 * at a readable zoom.
 */
export function planCamera(
  path: readonly FlowBox[],
  first: readonly FlowBox[],
  pane: { width: number; height: number },
  insets: Insets,
  overlays: readonly FlowBox[] = [],
): CameraPlan | null {
  const all = union(path);
  if (!all) return null;
  const fit =
    fitAvoiding(path, pane, overlays, { margin: 0, gap: 16, maxZoom: MAX_ZOOM, insets }) ?? frame(all, pane, insets);
  if (fit.zoom >= FOLLOW_BELOW) return { mode: "fit", view: fit, zoom: fit.zoom };
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
 * clear of `overlays` (the trace card's first rows), or null when it already is (with a margin).
 * The zoom never changes while following.
 */
export function followPan(
  frontier: readonly FlowBox[],
  current: View,
  pane: { width: number; height: number },
  insets: Insets,
  overlays: readonly FlowBox[] = [],
  margin = 32,
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
  return (
    fitAvoiding(frontier, pane, overlays, { margin: 0, gap: 16, minZoom: z, maxZoom: z, insets }) ??
    frame(box, pane, insets, z)
  );
}
