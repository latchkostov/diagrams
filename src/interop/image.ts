import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { MarkdownView, loadMarkdown } from "../components/markdown/lazy";
// PNG / SVG export of the live canvas with html-to-image. We render React Flow's viewport element
// at 1:1 zoom, cropped to the diagram's bounds, so the image doesn't depend on the current pan/zoom
// or window size. html-to-image is loaded on demand (only when someone exports an image), and its clone runs in
// time slices (imageClone.ts): the tab keeps painting and the export can be cancelled. While it runs, input to the
// page is held (but for the toast's Cancel), so nothing changes the canvas between two slices of the same picture.

import { dataUrlToBlob } from "./files";
import { holdInput } from "../lib/inputHold";
import type { AnnotationShape } from "../model/types";
import { whenShapeGeometryReady } from "../canvas/shapes/readiness";
import { geometrySnapshot } from "../canvas/shapes/runtime";
import { t } from "../i18n";

export interface ImageOptions {
  /** Pixel ratio for PNG (1 or 2). */
  scale?: number;
  transparent?: boolean;
  /** Padding around the diagram in px. */
  padding?: number;
  /** A header above the diagram: its title and description, as presentation shows them. */
  header?: { title: string; description?: string };
  /** Cancels the export: it stops at the next slice and puts the canvas back as it was. */
  signal?: AbortSignal;
  /** How far the export has got (0 to 1), told between slices. */
  onProgress?: (done: number) => void;
  /** Escape pressed while the export runs (its owner cancels it). */
  onEscape?: () => void;
  /** Throws when the captured document identity or edit revision changes. */
  check?: () => void;
}

type Bounds = { x: number; y: number; width: number; height: number };

/** Room between the header and the diagram, in px. */
const HEADER_GAP = 28;

/**
 * Puts the title (and description) above the diagram, in flow coordinates, for the shot. It wraps
 * at the diagram's width (never narrower than a readable line). Returns its box and the undo.
 */
function addHeader(viewport: HTMLElement, b: Bounds, header: { title: string; description?: string }) {
  const el = document.createElement("div");
  el.className = "export-header";
  el.dataset.testid = "export-header";
  const h = document.createElement("h1");
  h.textContent = header.title;
  el.append(h);
  let descriptionRoot: ReturnType<typeof createRoot> | undefined;
  if (header.description) {
    const text = header.description;
    const description = document.createElement("div");
    el.append(description);
    const root = createRoot(description);
    descriptionRoot = root;
    flushSync(() => root.render(createElement(MarkdownView, { text, testId: "export-header-description" })));
  }
  el.style.left = `${b.x}px`;
  el.style.overflowWrap = "anywhere";
  el.style.maxWidth = `${Math.max(b.width, 420)}px`;
  viewport.append(el);
  return {
    ready: () => Promise.all(Array.from(el.getElementsByTagName("img"), (image) => image.decode().catch(() => {}))),
    measure: () => {
      // Layout sizes ignore viewport zoom. Images must finish decoding before this measurement.
      const rect = { x: b.x, y: b.y - HEADER_GAP - el.offsetHeight, width: el.offsetWidth, height: el.offsetHeight };
      el.style.top = `${rect.y}px`;
      return rect;
    },
    remove: () => {
      descriptionRoot?.unmount();
      el.remove();
    },
  };
}

function unionBounds(a: Bounds, b: Bounds): Bounds {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

const translateRe = /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)/;

/** Diagram bounds in flow coordinates, from the rendered nodes (groups included). */
function bounds(viewport: HTMLElement): Bounds | undefined {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of viewport.querySelectorAll<HTMLElement>(".react-flow__node")) {
    const m = translateRe.exec(el.style.transform);
    if (!m) continue;
    const x = parseFloat(m[1]);
    const y = parseFloat(m[2]);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + el.offsetWidth);
    maxY = Math.max(maxY, y + el.offsetHeight);
  }
  return Number.isFinite(minX) ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : undefined;
}

function findViewport(): HTMLElement {
  const vp = document.querySelector<HTMLElement>('[data-testid="canvas-wrap"] .react-flow__viewport');
  if (!vp) throw new Error("Open a diagram on the canvas to export an image.");
  return vp;
}

let fontCss: Promise<string> | undefined;

const MAX_PIXELS = 16_000_000; // keep well under browsers' canvas limits

/** The picture as a file: a PNG, or the SVG's text (what its data URL would decode to). */
export async function renderDiagramImage(kind: "png" | "svg", opts: ImageOptions = {}): Promise<Blob> {
  opts.signal?.throwIfAborted();
  opts.check?.();
  const viewport = findViewport();
  const content = bounds(viewport);
  if (!content) throw new Error("This diagram is empty, so there's nothing to export.");
  const header = opts.header?.title.trim() ? addHeader(viewport, content, opts.header) : undefined;
  let defsClone: SVGElement | undefined;
  let unselect = () => {};
  const paint = new SvgPaint();
  const releaseInput = holdInput(opts.onEscape);
  let slicer: import("./imageClone").Slicer | undefined;
  try {
    await unlessCancelled(
      whenShapeGeometryReady({
        annotations: Array.from(viewport.querySelectorAll<HTMLElement>('[data-kind="shape"][data-shape]'), (el) => ({
          kind: "shape",
          shape: el.dataset.shape as AnnotationShape,
        })),
      }),
      opts.signal,
    );
    const geometryRevision = geometrySnapshot();
    const check = () => {
      opts.check?.();
      if (geometrySnapshot() !== geometryRevision) throw new Error(t("storageDialog.tryAgain"));
    };
    // Insert the header before yielding, then finish its Markdown before finding images or measuring it.
    // Loading belongs inside the input hold and cleanup, including cancellation and failed downloads.
    await unlessCancelled(loadMarkdown(), opts.signal);
    check();
    if (header) await unlessCancelled(header.ready(), opts.signal);
    check();
    const b = header ? unionBounds(content, header.measure()) : content;
    const pad = opts.padding ?? 48;
    const width = Math.ceil(b.width + pad * 2);
    const height = Math.ceil(b.height + pad * 2);
    let scale = opts.scale ?? 2;
    if (width * height * scale * scale > MAX_PIXELS) scale = Math.max(0.5, Math.sqrt(MAX_PIXELS / (width * height)));

    const css = getComputedStyle(viewport.closest(".canvas-wrap") ?? document.body);
    const bg = opts.transparent
      ? undefined
      : css.backgroundColor && css.backgroundColor !== "rgba(0, 0, 0, 0)"
        ? css.backgroundColor
        : getComputedStyle(document.body).backgroundColor;

    const [{ toPng, toSvgText, Slicer }, { getWebFontCSS }] = await unlessCancelled(
      Promise.all([import("./imageClone"), import("html-to-image/es/embed-webfonts")]),
      opts.signal,
    );
    slicer = new Slicer(viewport.getElementsByTagName("*").length, {
      signal: opts.signal,
      onProgress: opts.onProgress,
      check,
    });
    slicer.progress(0.02);
    // Edge arrowheads are defined in an <svg><defs> outside the viewport; clone them inside for the shot.
    defsClone = document.querySelector("svg.df-defs")?.cloneNode(true) as SVGElement | undefined;
    if (defsClone) {
      defsClone.setAttribute("style", "position:absolute;width:0;height:0;overflow:hidden");
      viewport.prepend(defsClone);
    }
    // The picture shows the diagram, not the editing state: no selection outlines or resize handles.
    unselect = clearSelectionMarks(viewport);
    // html-to-image copies computed styles onto HTML elements only; SVG children (edge paths, arrow
    // heads, annotation shapes) keep just their attributes, so their CSS fills and strokes would be
    // lost (black blobs). Write the computed paint onto them for the shot.
    await paint.apply(viewport, slicer);
    // Embedding web fonts is the slow part (fetch + inline every @font-face): do it once per session.
    fontCss ??= getWebFontCSS(viewport, {}).catch(() => "");
    const fontEmbedCSS = await slicer.wait(fontCss);
    slicer.progress(0.15);
    const options = {
      fontEmbedCSS,
      width,
      height,
      pixelRatio: scale,
      backgroundColor: bg,
      cacheBust: false,
      style: {
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate(${pad - b.x}px, ${pad - b.y}px) scale(1)`,
      },
      // Editing affordances aren't part of the picture: connection and resize handles (the "+" too), and the
      // "Double-click to write" placeholder of an empty note.
      filter: (node: Node) =>
        !(node instanceof HTMLElement && EDITING_ONLY.some((cls) => node.classList.contains(cls))) &&
        !(node instanceof SVGElement && EDITING_ONLY_SVG.some((cls) => node.classList.contains(cls))),
    };
    const image =
      kind === "png"
        ? dataUrlToBlob(await toPng(viewport, options, slicer))
        : new Blob([await toSvgText(viewport, options, slicer)], { type: "image/svg+xml;charset=utf-8" });
    slicer.stopIfAsked();
    opts.onProgress?.(1);
    return image;
  } finally {
    slicer?.dispose();
    releaseInput();
    paint.restore();
    unselect();
    defsClone?.remove();
    header?.remove();
  }
}

/** `promise`, or the cancel's reason if the export is cancelled first (a stalled download never holds the page). */
async function unlessCancelled<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  let onAbort = () => {};
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        onAbort = () => reject(signal.reason as Error);
        signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

const EDITING_ONLY = [
  "react-flow__handle",
  "react-flow__resize-control",
  "ann-placeholder",
  // A selected edge's ends and the outline of where a node will land (flow building, D3 and D8).
  "edge-end",
  "landing-outline",
  // The Checks card's markers: a review aid, and their tooltips carry the findings' words.
  "check-markers",
  // Others in a room (their outlines, pointers and names): ephemeral, and theirs, never in a picture.
  "presence-layer",
];
// SVG editing chrome (not an HTMLElement): the line an insert would split.
const EDITING_ONLY_SVG = ["insert-line", "edge-end-line"];

const SELECTION_CLASSES = ["selected", "is-selected", "is-editing"] as const;

/** Takes the selection classes off for the shot; returns the function that puts them back. */
function clearSelectionMarks(root: HTMLElement): () => void {
  const removed: [Element, string][] = [];
  for (const cls of SELECTION_CLASSES) {
    for (const el of root.querySelectorAll(`.${cls}`)) {
      el.classList.remove(cls);
      removed.push([el, cls]);
    }
  }
  return () => {
    for (const [el, cls] of removed) el.classList.add(cls);
  };
}

/** SVG paint that comes from stylesheets (classes, variables) and must travel with the clone. */
const SVG_PAINT = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "display",
  "visibility",
] as const;

/**
 * Each SVG child's computed paint, written into its style attribute for the shot, and put back by `restore`. Every
 * value is read before any is written, so one write can't change what a later read sees; both run in slices (a big
 * diagram has thousands of edge parts), and `restore` undoes whatever was written, even if a cancel stopped it.
 */
class SvgPaint {
  private saved: [SVGElement, string | null][] = [];

  async apply(root: HTMLElement, slicer: { breathe(): Promise<void>; progress(done: number): void }) {
    const els = [...root.querySelectorAll<SVGElement>("svg *")];
    const values: (readonly (readonly [string, string])[])[] = [];
    for (const el of els) {
      const cs = getComputedStyle(el);
      values.push(SVG_PAINT.map((p) => [p, cs.getPropertyValue(p)] as const));
      slicer.progress(0.02 + (0.1 * values.length) / Math.max(1, els.length * 2));
      await slicer.breathe();
    }
    for (const [i, el] of els.entries()) {
      this.saved.push([el, el.getAttribute("style")]);
      for (const [p, v] of values[i]) if (v) el.style.setProperty(p, v);
      slicer.progress(0.07 + (0.05 * (i + 1)) / Math.max(1, els.length));
      await slicer.breathe();
    }
  }

  restore() {
    for (const [el, style] of this.saved) {
      if (style === null) el.removeAttribute("style");
      else el.setAttribute("style", style);
    }
    this.saved = [];
  }
}

/**
 * A standalone SVG (with its own colours and sizes, e.g. a sequence diagram) as a PNG data URL,
 * rendered through an <img> onto a canvas at `scale` (kept under the canvas pixel budget).
 */
export async function svgToPng(svg: string, width: number, height: number, scale = 2): Promise<string> {
  const ratio = width * height * scale * scale > MAX_PIXELS ? Math.sqrt(MAX_PIXELS / (width * height)) : scale;
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("The SVG couldn't be drawn."));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2D canvas available.");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}
