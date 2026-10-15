import { useLayoutEffect, useRef, type RefObject } from "react";
import { accessibleColor, type RgbaColor } from "../model/colors";
import { resolveAnnotationColor } from "./annotations";
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
  colors.set(css, color);
  return color;
}

const overlaps = (a: DOMRect, b: DOMRect) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const blend = (base: RgbaColor, fill: RgbaColor): RgbaColor => ({
  r: fill.r * fill.a + base.r * (1 - fill.a),
  g: fill.g * fill.a + base.g * (1 - fill.a),
  b: fill.b * fill.a + base.b * (1 - fill.a),
  a: 1,
});

/** One measurement pass shared by custom captions; preset captions always use theme ink. */
export function measureCaptionContrast(canvas: HTMLElement, nodes: readonly FlowNode[], background: RgbaColor) {
  const elements = new Map(
    [...canvas.querySelectorAll<HTMLElement>('[data-testid^="annotation-"], [data-testid^="group-"]')].map(
      (el) => [el.dataset.testid, el] as const,
    ),
  );
  const element = (id: string) => elements.get(id);
  const regions = nodes
    .flatMap((n) => {
      if (n.hidden) return [];
      const zone = n.type === "annotation" && n.data.kind === "zone";
      if (!zone && n.type !== "boundary") return [];
      const el = element(n.type === "boundary" ? `group-${n.data.groupId}` : `annotation-${n.id}`);
      if (!el) return [];
      const fill = cssColor(getComputedStyle(el).backgroundColor);
      return fill ? [{ box: el.getBoundingClientRect(), fill, layer: zone ? -2 : -1 }] : [];
    })
    .sort((a, b) => a.layer - b.layer);
  for (const n of nodes) {
    if (n.hidden || n.type !== "annotation" || n.data.kind !== "text") continue;
    const color = resolveAnnotationColor(n.data.color, "text");
    if (color.isPreset) continue;
    const el = element(`annotation-${n.id}`);
    if (!el) continue;
    const box = el.getBoundingClientRect();
    let bg = background;
    let ink = accessibleColor(color.hex, bg, "var(--text)");
    // Check each overlapping fill as well as the canvas: partially covered captions must read
    // on both. Regions are composited in their actual paint order (zones, then boundaries).
    for (const region of regions) {
      if (!overlaps(box, region.box)) continue;
      bg = blend(bg, region.fill);
      if (accessibleColor(color.hex, bg, "var(--text)") === "var(--text)") ink = "var(--text)";
    }
    el.style.setProperty("--ann-text-ink", ink);
  }
}

export function useCaptionContrast(
  wrapper: RefObject<HTMLDivElement | null>,
  nodes: readonly FlowNode[],
  theme: string,
  canvasColor?: string,
) {
  const background = useRef<{ key: string; color: RgbaColor | null } | null>(null);
  useLayoutEffect(() => {
    if (
      !nodes.some(
        (n) =>
          n.type === "annotation" && n.data.kind === "text" && !resolveAnnotationColor(n.data.color, "text").isPreset,
      )
    )
      return;
    const frame = requestAnimationFrame(() => {
      const canvas = wrapper.current;
      if (!canvas) return;
      const key = `${theme}:${canvasColor}`;
      if (background.current?.key !== key)
        background.current = { key, color: cssColor(getComputedStyle(canvas).backgroundColor) };
      if (background.current.color) measureCaptionContrast(canvas, nodes, background.current.color);
    });
    return () => cancelAnimationFrame(frame);
  }, [wrapper, nodes, theme, canvasColor]);
}
