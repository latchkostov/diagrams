// PNG / SVG export of the live canvas with html-to-image. We render React Flow's viewport element
// at 1:1 zoom, cropped to the diagram's bounds, so the image doesn't depend on the current pan/zoom
// or window size. html-to-image is loaded on demand (only when someone exports an image).

export interface ImageOptions {
  /** Pixel ratio for PNG (1 or 2). */
  scale?: number;
  transparent?: boolean;
  /** Padding around the diagram in px. */
  padding?: number;
}

const translateRe = /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)/;

/** Diagram bounds in flow coordinates, from the rendered nodes (groups included). */
function bounds(viewport: HTMLElement) {
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
  const b = bounds(viewport);
  if (!b) throw new Error("This diagram is empty, so there's nothing to export.");
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
      // Connection handles are editing affordances, not part of the picture.
      filter: (node: Node) => !(node instanceof HTMLElement && node.classList.contains("react-flow__handle")),
    };
    return kind === "png" ? await toPng(viewport, options) : await toSvg(viewport, options);
  } finally {
    defsClone?.remove();
  }
}
