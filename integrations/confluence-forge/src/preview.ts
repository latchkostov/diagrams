import type { DiagramFile } from "../../../src/model/types";
import { estimateCardSize } from "../../../src/canvas/nodes/size";
import { catalog } from "../../../src/stencils/catalog";
import { t } from "../../../src/i18n/core";

const accents = new Map(catalog.map((stencil) => [stencil.id, stencil.accent]));
const PADDING = 12;
const LABEL_SIZE = 13.5;

/** Still geometry in diagram units, fitted to the card without a viewer or simulation runtime. */
export function diagramPreview(diagram: DiagramFile) {
  const nodes = diagram.nodes.map((node) => ({
    ...node,
    ...estimateCardSize(node.label ?? "", node.sublabel),
  }));
  const groups = diagram.groups ?? [];
  const boxes = [...nodes, ...groups];
  const minX = boxes.length ? Math.min(...boxes.map((box) => box.x)) : 0;
  const minY = boxes.length ? Math.min(...boxes.map((box) => box.y)) : 0;
  const spanX = Math.max(1, ...boxes.map((box) => box.x + box.width - minX));
  const spanY = Math.max(1, ...boxes.map((box) => box.y + box.height - minY));
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.dataset.testid = "forge-preview";
  svg.dataset.nodes = String(nodes.length);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", t("viewerForge.preview", { title: diagram.title }));
  const shape = (tag: "rect" | "line" | "text", attributes: Record<string, string | number>) => {
    const el = document.createElementNS(svg.namespaceURI, tag);
    for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, String(value));
    svg.append(el);
    return el;
  };
  for (const { x, y, width, height } of groups)
    shape("rect", { x, y, width, height, rx: 6, class: "preview-boundary" });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const { from, to } of diagram.edges) {
    const a = byId.get(from);
    const b = byId.get(to);
    if (!a || !b || a === b) continue;
    shape("line", {
      x1: a.x + a.width / 2,
      y1: a.y + a.height / 2,
      x2: b.x + b.width / 2,
      y2: b.y + b.height / 2,
      class: "preview-edge",
    });
  }
  const labels = nodes.map(({ x, y, width, height, stencil, label: text }) => {
    shape("rect", { x, y, width, height, rx: 5, class: "preview-node" });
    shape("rect", { x, y: y + 5, width: 4, height: height - 10, fill: accents.get(stencil) ?? "#64748b" });
    const label = shape("text", {
      x: x + 12,
      y: y + height / 2,
      "dominant-baseline": "middle",
      "font-size": LABEL_SIZE,
      class: "preview-label",
    });
    label.textContent = (text ?? "").slice(0, 24);
    label.remove();
    return label;
  });
  const fit = () => {
    const width = Math.max(1, svg.clientWidth - PADDING * 2);
    const height = Math.max(1, svg.clientHeight - PADDING * 2);
    const scale = Math.min(width / spanX, height / spanY, 1.5);
    const w = width / scale;
    const h = height / scale;
    svg.setAttribute("viewBox", `${minX - (w - spanX) / 2} ${minY - (h - spanY) / 2} ${w} ${h}`);
    for (const label of labels) {
      if (LABEL_SIZE * scale >= 9) svg.append(label);
      else label.remove();
    }
  };
  return { svg, fit };
}
