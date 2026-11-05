import type { LiveScene } from "./liveScene";
import type { ViewState } from "./renderProtocol";
import type { ProbeResult } from "./liveRenderer";
export const TEST_HOOKS = import.meta.env.DEV || import.meta.env.VITE_E2E === "1";
// ------------------------------------------------------------------ the march canvas

/** Marks the root while a canvas draws the marching ants (live.css stops the SVG's own march). */
export const MARCH_ATTR = "data-live-march";

/**
 * The marching ants' canvas: last in React Flow's edge layer, so it paints above the edges and below
 * the nodes (the particle canvases sit above the nodes). Null when there's no edge layer.
 */
export function mountMarchCanvas(root: HTMLElement): HTMLCanvasElement | null {
  const layer = root.querySelector(".react-flow__edges");
  if (!layer) return null;
  const el = document.createElement("canvas");
  el.className = "lv-canvas lv-canvas-march";
  el.dataset.testid = "live-canvas-march";
  el.setAttribute("aria-hidden", "true");
  layer.appendChild(el);
  return el;
}

/** Keeps the march canvas last in the edge layer (edges mounted later would paint over it). */
export function keepLast(el: HTMLCanvasElement | null, root: HTMLElement): void {
  if (!el) return;
  const layer = root.querySelector(".react-flow__edges");
  if (layer && (el.parentElement !== layer || el.nextSibling)) layer.appendChild(el);
}

// ------------------------------------------------------------------ placement

/**
 * The canvases live inside React Flow's viewport (so DOM order puts them between the nodes and the
 * badges); this undoes the viewport transform so they cover exactly the visible pane.
 */
export class CanvasPlacement {
  #els: readonly (HTMLCanvasElement | null)[];

  #sizeKey = "";
  #key = "";
  constructor(els: readonly (HTMLCanvasElement | null)[]) {
    this.#els = els;
  }

  place(v: ViewState): void {
    const sizeKey = `${v.width}|${v.height}`;
    if (sizeKey !== this.#sizeKey) {
      this.#sizeKey = sizeKey;
      for (const el of this.#els) {
        if (!el) continue;
        el.style.width = `${v.width}px`;
        el.style.height = `${v.height}px`;
      }
    }
    const key = `${v.x}|${v.y}|${v.zoom}`;
    if (key !== this.#key) {
      this.#key = key;
      const t = `translate(${-v.x / v.zoom}px, ${-v.y / v.zoom}px) scale(${1 / v.zoom})`;
      for (const el of this.#els) if (el) el.style.transform = t;
    }
  }
}

export function viewOf(scene: LiveScene): ViewState {
  const [x, y, zoom] = scene.transform();
  const { width, height } = scene.size();
  return { x, y, zoom, width, height, dpr: scene.dpr() };
}

/** Client CSS px → the layer's device px. */
export function deviceRect(
  canvas: HTMLCanvasElement,
  dpr: number,
  r: { x: number; y: number; width: number; height: number },
) {
  const box = canvas.getBoundingClientRect();
  // The canvas box is the pane in CSS px (the inverse transform cancels the zoom).
  const sx = box.width ? (canvas.style.width ? parseFloat(canvas.style.width) / box.width : 1) * dpr : dpr;
  const sy = box.height ? (canvas.style.height ? parseFloat(canvas.style.height) / box.height : 1) * dpr : dpr;
  return {
    x: Math.max(0, Math.floor((r.x - box.left) * sx)),
    y: Math.max(0, Math.floor((r.y - box.top) * sy)),
    w: Math.max(1, Math.floor(r.width * sx)),
    h: Math.max(1, Math.floor(r.height * sy)),
    left: box.left,
    top: box.top,
    scale: sx,
  };
}

export function probeResult(data: Uint8ClampedArray, r: ReturnType<typeof deviceRect>): ProbeResult {
  return { data, width: r.w, height: r.h, x: r.left + r.x / r.scale, y: r.top + r.y / r.scale, scale: r.scale };
}

export const NO_PIXELS: ProbeResult = { data: new Uint8ClampedArray(), width: 0, height: 0, x: 0, y: 0, scale: 1 };
