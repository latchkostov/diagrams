// PNG / SVG export of the live canvas with html-to-image. We render React Flow's viewport element
// at 1:1 zoom, cropped to the diagram's bounds, so the image doesn't depend on the current pan/zoom
// or window size. html-to-image is loaded on demand (only when someone exports an image).

export interface ImageOptions {
  /** Pixel ratio for PNG (1 or 2). */
  scale?: number;
  transparent?: boolean;
  /** Padding around the diagram in px. */
  padding?: number;
  /** A header above the diagram: its title and description, as presentation shows them. */
  header?: { title: string; description?: string };
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
  const h = document.createElement("h1");
  h.textContent = header.title;
  el.append(h);
  if (header.description) {
    const p = document.createElement("p");
    p.textContent = header.description;
    el.append(p);
  }
  el.style.left = `${b.x}px`;
  el.style.maxWidth = `${Math.max(b.width, 420)}px`;
  viewport.append(el);
  // offsetWidth / offsetHeight are layout sizes, unaffected by the viewport's zoom.
  const rect = { x: b.x, y: b.y - HEADER_GAP - el.offsetHeight, width: el.offsetWidth, height: el.offsetHeight };
  el.style.top = `${rect.y}px`;
  return { rect, remove: () => el.remove() };
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

export async function renderDiagramImage(kind: "png" | "svg", opts: ImageOptions = {}): Promise<string> {
  const viewport = findViewport();
  const content = bounds(viewport);
  if (!content) throw new Error("This diagram is empty, so there's nothing to export.");
  const header = opts.header?.title.trim() ? addHeader(viewport, content, opts.header) : undefined;
  const b = header ? unionBounds(content, header.rect) : content;
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

  // Edge arrowheads are defined in an <svg><defs> outside the viewport; clone them inside for the shot.
  const defs = document.querySelector("svg.df-defs");
  const defsClone = defs?.cloneNode(true) as SVGElement | undefined;
  if (defsClone) {
    defsClone.setAttribute("style", "position:absolute;width:0;height:0;overflow:hidden");
    viewport.prepend(defsClone);
  }
  // The picture shows the diagram, not the editing state: no selection outlines or resize handles.
  const unselect = clearSelectionMarks(viewport);
  // html-to-image copies computed styles onto HTML elements only; SVG children (edge paths, arrow
  // heads, annotation shapes) keep just their attributes, so their CSS fills and strokes would be
  // lost (black blobs). Write the computed paint onto them for the shot.
  const restoreSvg = inlineSvgPaint(viewport);
  try {
    const { toPng, toSvg, getFontEmbedCSS } = await import("html-to-image");
    // Embedding web fonts is the slow part (fetch + inline every @font-face): do it once per session.
    fontCss ??= getFontEmbedCSS(viewport).catch(() => "");
    const options = {
      fontEmbedCSS: await fontCss,
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
      // Editing affordances aren't part of the picture: connection and resize handles, and the
      // "Double-click to write" placeholder of an empty note.
      filter: (node: Node) =>
        !(node instanceof HTMLElement && EDITING_ONLY.some((cls) => node.classList.contains(cls))),
    };
    return kind === "png" ? await toPng(viewport, options) : await toSvg(viewport, options);
  } finally {
    restoreSvg();
    unselect();
    defsClone?.remove();
    header?.remove();
  }
}

const EDITING_ONLY = ["react-flow__handle", "react-flow__resize-control", "ann-placeholder"];

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

/** Writes each SVG child's computed paint into its style attribute; returns the undo. */
function inlineSvgPaint(root: HTMLElement): () => void {
  const saved: [SVGElement, string | null][] = [];
  const els = root.querySelectorAll<SVGElement>("svg *");
  // Read everything first, then write, so one write can't change what the next read sees.
  const values = [...els].map((el) => {
    const cs = getComputedStyle(el);
    return SVG_PAINT.map((p) => [p, cs.getPropertyValue(p)] as const);
  });
  els.forEach((el, i) => {
    saved.push([el, el.getAttribute("style")]);
    for (const [p, v] of values[i]) if (v) el.style.setProperty(p, v);
  });
  return () => {
    for (const [el, style] of saved) {
      if (style === null) el.removeAttribute("style");
      else el.setAttribute("style", style);
    }
  };
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
