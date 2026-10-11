// Fit-view that keeps diagram content clear of floating chrome (title card, minimap, zoom
// controls, live bar...). Rather than one fixed padding, it tries, for each overlay, leaving it
// alone or keeping content beside / below it, and picks the largest zoom at which no node sits
// under any overlay. An empty corner under the title card therefore costs no zoom at all.

import { intersects, union, type Rect } from "./rect";

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface FitOptions {
  /** Breathing room around the content, in screen px. */
  margin?: number;
  /** Gap kept between content and an overlay it avoids. */
  gap?: number;
  minZoom?: number;
  maxZoom?: number;
  /** Extra screen space to keep clear on each side (e.g. a bar that isn't mounted yet). */
  insets?: { top?: number; right?: number; bottom?: number; left?: number };
}

/** Viewport placing flow-space `box` centred in the screen-space `area`. */
function place(box: Rect, area: Rect, minZoom: number, maxZoom: number): Viewport | null {
  if (area.width <= 0 || area.height <= 0) return null;
  const zoom = Math.max(
    minZoom,
    Math.min(maxZoom, area.width / Math.max(1, box.width), area.height / Math.max(1, box.height)),
  );
  return {
    zoom,
    x: area.x + (area.width - box.width * zoom) / 2 - box.x * zoom,
    y: area.y + (area.height - box.height * zoom) / 2 - box.y * zoom,
  };
}

const toScreen = (r: Rect, v: Viewport): Rect => ({
  x: r.x * v.zoom + v.x,
  y: r.y * v.zoom + v.y,
  width: r.width * v.zoom,
  height: r.height * v.zoom,
});

/**
 * @param items  flow-space rects that must stay visible and uncovered (nodes, group boxes)
 * @param pane   the canvas size in screen px
 * @param overlays screen-space rects of floating chrome, relative to the pane
 */
export function fitAvoiding(
  items: readonly Rect[],
  pane: { width: number; height: number },
  overlays: readonly Rect[],
  opts: FitOptions = {},
): Viewport | null {
  const box = union(items);
  if (!box) return null;
  const margin = opts.margin ?? 40;
  const gap = opts.gap ?? 12;
  const minZoom = opts.minZoom ?? 0.15;
  const maxZoom = opts.maxZoom ?? 1.25;
  const ins = { top: 0, right: 0, bottom: 0, left: 0, ...opts.insets };
  const base: Rect = {
    x: margin + ins.left,
    y: margin + ins.top,
    width: pane.width - 2 * margin - ins.left - ins.right,
    height: pane.height - 2 * margin - ins.top - ins.bottom,
  };
  const obs = overlays.filter((o) => o.width > 0 && o.height > 0 && intersects(o, { x: 0, y: 0, ...pane }));

  // For each overlay: ignore it, or keep content on the far side of it vertically / horizontally.
  type Option = (a: Rect) => Rect;
  const options: Option[][] = obs.map((o) => {
    const top = o.y + o.height / 2 < pane.height / 2;
    const left = o.x + o.width / 2 < pane.width / 2;
    const vertical: Option = top ? (a) => clipTop(a, o.y + o.height + gap) : (a) => clipBottom(a, o.y - gap);
    const horizontal: Option = left ? (a) => clipLeft(a, o.x + o.width + gap) : (a) => clipRight(a, o.x - gap);
    return [(a) => a, vertical, horizontal];
  });

  let best: Viewport | null = null;
  const covered = (v: Viewport) => items.some((it) => obs.some((o) => intersects(toScreen(it, v), o, 0.5)));
  const total = options.reduce((n, o) => n * o.length, 1);
  for (let combo = 0; combo < total; combo++) {
    let area = base;
    let c = combo;
    for (const opt of options) {
      area = opt[c % opt.length](area);
      c = Math.floor(c / opt.length);
    }
    const v = place(box, area, minZoom, maxZoom);
    if (!v || (best && v.zoom <= best.zoom + 1e-6)) continue;
    if (!covered(v)) best = v;
  }
  // Nothing avoids everything (tiny pane): fall back to the plain fit.
  return best ?? place(box, base, minZoom, maxZoom);
}

const clipTop = (a: Rect, y: number): Rect => (y <= a.y ? a : { ...a, y, height: a.height - (y - a.y) });
const clipBottom = (a: Rect, y: number): Rect => (y >= a.y + a.height ? a : { ...a, height: y - a.y });
const clipLeft = (a: Rect, x: number): Rect => (x <= a.x ? a : { ...a, x, width: a.width - (x - a.x) });
const clipRight = (a: Rect, x: number): Rect => (x >= a.x + a.width ? a : { ...a, width: x - a.x });

/**
 * The smallest pan (zoom unchanged) that brings flow-space `want` inside `view` (screen px, relative
 * to the pane). When `want` is too big to fit, `must` (a part of it, e.g. the selection without its
 * edges) is kept in view instead, and centred if even that is too big. Null when nothing needs to move.
 */
export function panIntoView(want: Rect, must: Rect, viewport: Viewport, view: Rect): Viewport | null {
  const { zoom: z } = viewport;
  const axis = (lo: number, hi: number, mustLo: number, mustHi: number, start: number, size: number) => {
    const shift = (a: number, b: number) => (a < start ? start - a : b > start + size ? start + size - b : 0);
    if (hi - lo <= size) return shift(lo, hi);
    if (mustHi - mustLo <= size) return shift(mustLo, mustHi);
    return start + size / 2 - (mustLo + mustHi) / 2;
  };
  const sx = (x: number) => x * z + viewport.x;
  const sy = (y: number) => y * z + viewport.y;
  const dx = axis(sx(want.x), sx(want.x + want.width), sx(must.x), sx(must.x + must.width), view.x, view.width);
  const dy = axis(sy(want.y), sy(want.y + want.height), sy(must.y), sy(must.y + must.height), view.y, view.height);
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return null;
  return { x: viewport.x + dx, y: viewport.y + dy, zoom: z };
}
