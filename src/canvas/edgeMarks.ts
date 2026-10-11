import type { Box } from "./placement";

const samples = new WeakMap<SVGPathElement, { geometry: string | null; boxes: Box[] }>();

/** Cache samples by rendered route geometry; pan, zoom and text edits don't change the path. */
export function edgeMarks(root: HTMLElement | null): Box[] {
  const out: Box[] = [];
  if (!root) return out;
  for (const path of root.querySelectorAll<SVGPathElement>(".react-flow__edge-path")) {
    const geometry = path.getAttribute("d");
    let cached = samples.get(path);
    if (!cached || cached.geometry !== geometry) {
      const boxes: Box[] = [];
      const len = typeof path.getTotalLength === "function" ? path.getTotalLength() : 0;
      if (len > 0)
        for (let d = 0; d <= len; d += 24) {
          const p = path.getPointAtLength(d);
          boxes.push({ x: p.x - 2, y: p.y - 2, width: 4, height: 4 });
        }
      cached = { geometry, boxes };
      samples.set(path, cached);
    }
    out.push(...cached.boxes);
  }
  return out;
}
