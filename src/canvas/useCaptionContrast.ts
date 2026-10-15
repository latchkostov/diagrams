import { useEffectEvent, useLayoutEffect, useRef, type RefObject } from "react";
import { accessibleColor, type RgbaColor } from "../model/colors";
import { resolveAnnotationColor } from "./annotations";
import { SpatialGrid } from "./geometry/spatial";
import type { Rect } from "./geometry/rect";
import type { FlowNode } from "./types";

let context: CanvasRenderingContext2D | null | undefined;
const colors = new Map<string, RgbaColor>();
function cssColor(css: string): RgbaColor | null {
  const cached = colors.get(css);
  if (cached) return cached;
  context ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = css;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
  const color = { r, g, b, a: a / 255 };
  if (colors.size >= 512) colors.clear();
  colors.set(css, color);
  return color;
}

const boxOf = (el: HTMLElement): Rect => {
  const b = el.getBoundingClientRect();
  return { x: b.left, y: b.top, width: b.right - b.left, height: b.bottom - b.top };
};
const blend = (base: RgbaColor, fill: RgbaColor): RgbaColor => ({
  r: fill.r * fill.a + base.r * (1 - fill.a),
  g: fill.g * fill.a + base.g * (1 - fill.a),
  b: fill.b * fill.a + base.b * (1 - fill.a),
  a: 1,
});
const intersection = (a: Rect, b: Rect): Rect | null => {
  const x = Math.max(a.x, b.x),
    y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
};
type Region = { box: Rect; fill: RgbaColor; order: number };
const FALLBACK = "var(--text)";
// One shared operation budget bounds spatial queries and subdivision, even for hostile overlaps.
export const CAPTION_WORK_LIMIT = 32_768;
const results = new WeakMap<HTMLElement, Map<string, { key: string; ink: string; work: number }>>();

function captionInk(hex: string, box: Rect, background: RgbaColor, regions: Region[], budget: { remaining: number }) {
  if (accessibleColor(hex, background, FALLBACK) === FALLBACK) return FALLBACK;
  let cells = [{ box, fill: background }];
  for (const region of regions) {
    const next: typeof cells = [];
    for (const cell of cells) {
      if (--budget.remaining < 0) return FALLBACK;
      const hit = intersection(cell.box, region.box);
      if (!hit) {
        next.push(cell);
        continue;
      }
      const fill = blend(cell.fill, region.fill);
      const b = cell.box;
      // Keep the uncovered parts separate: adjacent regions never paint over one another.
      for (const part of [
        { x: b.x, y: b.y, width: b.width, height: hit.y - b.y },
        { x: b.x, y: hit.y + hit.height, width: b.width, height: b.y + b.height - hit.y - hit.height },
        { x: b.x, y: hit.y, width: hit.x - b.x, height: hit.height },
        { x: hit.x + hit.width, y: hit.y, width: b.x + b.width - hit.x - hit.width, height: hit.height },
      ])
        if (part.width > 0 && part.height > 0) next.push({ box: part, fill: cell.fill });
      next.push({ box: hit, fill });
    }
    cells = next;
  }
  for (const cell of cells) {
    if (--budget.remaining < 0 || accessibleColor(hex, cell.fill, FALLBACK) === FALLBACK) return FALLBACK;
  }
  return hex;
}

/** Only renderer roots participate. Descendant test IDs are deliberately irrelevant. */
export function measureCaptionContrast(canvas: HTMLElement, nodes: readonly FlowNode[], background: RgbaColor) {
  const elements = new Map(
    [...canvas.querySelectorAll<HTMLElement>("[data-caption-root]")].map((el) => [el.dataset.testid, el] as const),
  );
  const regions = new SpatialGrid<Region>();
  const ordered = nodes
    .flatMap((n) => {
      if (n.hidden) return [];
      const zone = n.type === "annotation" && n.data.kind === "zone";
      if (!zone && n.type !== "boundary") return [];
      const el = elements.get(n.type === "boundary" ? `group-${n.data.groupId}` : `annotation-${n.id}`);
      if (!el) return [];
      const fill = cssColor(getComputedStyle(el).backgroundColor);
      return fill ? [{ box: boxOf(el), fill, layer: n.zIndex ?? (zone ? -2 : -1) }] : [];
    })
    .sort((a, b) => a.layer - b.layer);
  ordered.forEach((r, order) => regions.insert(r.box, { ...r, order }));
  const cache = results.get(canvas) ?? new Map();
  results.set(canvas, cache);
  const retained = new Set<string>();
  const budget = { remaining: CAPTION_WORK_LIMIT };
  for (const n of nodes) {
    if (n.hidden || n.type !== "annotation" || n.data.kind !== "text") continue;
    const color = resolveAnnotationColor(n.data.color, "text");
    if (color.isPreset) continue;
    const el = elements.get(`annotation-${n.id}`);
    if (!el) continue;
    const box = boxOf(el);
    const hits = regions
      .query(box, budget)
      ?.map((entry) => entry.item)
      .filter((r) => intersection(box, r.box))
      .sort((a, b) => a.order - b.order);
    const key = JSON.stringify([color.hex, box, background, hits]);
    const previous = cache.get(n.id);
    const before = budget.remaining;
    const ink =
      previous?.key === key ? previous.ink : hits ? captionInk(color.hex, box, background, hits, budget) : FALLBACK;
    if (previous?.key === key) budget.remaining -= previous.work;
    cache.set(n.id, { key, ink, work: before - budget.remaining });
    retained.add(n.id);
    el.style.setProperty("--ann-text-ink", ink);
  }
  for (const id of cache.keys()) if (!retained.has(id)) cache.delete(id);
}

/** Selection and service-only changes do not schedule DOM measurement. */
export function captionContrastKey(nodes: readonly FlowNode[]): string {
  return JSON.stringify(
    nodes
      .filter((n) => n.type === "boundary" || n.type === "annotation")
      .map((n) => [
        n.id,
        n.parentId,
        n.position,
        n.width,
        n.height,
        n.measured,
        n.hidden,
        n.zIndex,
        n.type === "boundary"
          ? [n.data.groupId, n.data.tone]
          : [n.data.kind, n.data.color, n.data.text, n.data.textSize],
      ]),
  );
}

export function useCaptionContrast(
  wrapper: RefObject<HTMLDivElement | null>,
  nodes: readonly FlowNode[],
  theme: string,
  canvasColor?: string,
) {
  const background = useRef<{ key: string; color: RgbaColor | null } | null>(null);
  const key = captionContrastKey(nodes);
  const measure = useEffectEvent(() => {
    const canvas = wrapper.current;
    if (
      !canvas ||
      !nodes.some(
        (n) =>
          n.type === "annotation" && n.data.kind === "text" && !resolveAnnotationColor(n.data.color, "text").isPreset,
      )
    )
      return;
    const backgroundKey = `${theme}:${canvasColor}`;
    if (background.current?.key !== backgroundKey)
      background.current = { key: backgroundKey, color: cssColor(getComputedStyle(canvas).backgroundColor) };
    if (background.current.color) measureCaptionContrast(canvas, nodes, background.current.color);
  });
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [key, theme, canvasColor]);
}
