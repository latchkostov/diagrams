import type { DiagramFile } from "../../../src/model/types";
import { diagramThumb } from "../../../src/lib/thumbnail";
import { t } from "../../../src/i18n/core";

/** The library's bounded thumbnail geometry, with labels, without a React or simulation runtime. */
export function diagramPreview(diagram: DiagramFile): SVGSVGElement {
  const thumb = diagramThumb(diagram);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.dataset.testid = "forge-preview";
  svg.dataset.nodes = String(thumb.nodes.length);
  svg.setAttribute("viewBox", `-5 -5 ${thumb.w + 10} ${thumb.h + 10}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", t("viewerForge.preview", { title: diagram.title }));
  const shape = (tag: "rect" | "line" | "text", attributes: Record<string, string | number>) => {
    const el = document.createElementNS(svg.namespaceURI, tag);
    for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, String(value));
    svg.append(el);
    return el;
  };
  for (const [x, y, width, height] of thumb.groups)
    shape("rect", { x, y, width, height, rx: 1, class: "preview-boundary" });
  for (const [from, to] of thumb.edges) {
    const a = thumb.nodes[from];
    const b = thumb.nodes[to];
    shape("line", {
      x1: a[0] + a[2] / 2,
      y1: a[1] + a[3] / 2,
      x2: b[0] + b[2] / 2,
      y2: b[1] + b[3] / 2,
      class: "preview-edge",
    });
  }
  thumb.nodes.forEach(([x, y, width, height, accent], index) => {
    shape("rect", { x, y, width, height, rx: 0.8, class: "preview-node" });
    shape("rect", { x, y: y + 0.8, width: 0.6, height: Math.max(0, height - 1.6), fill: accent });
    const label = shape("text", {
      x: x + 2,
      y: y + height / 2,
      "dominant-baseline": "middle",
      "font-size": Math.min(2.2, height / 3),
      class: "preview-label",
    });
    label.textContent = (diagram.nodes[index].label ?? "").slice(0, 24);
  });
  return svg;
}
