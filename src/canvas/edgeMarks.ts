import type { Box } from "./placement";

/** A small box along a drawn edge, and which edge it's on (so a selection can leave out its own edges). */
export type EdgeMark = Box & { edge?: string };

const samples = new WeakMap<SVGPathElement, { geometry: string | null; boxes: EdgeMark[] }>();

/** Cache samples by rendered route geometry; pan, zoom and text edits don't change the path. */
export function edgeMarks(root: HTMLElement | null): EdgeMark[] {
  const out: EdgeMark[] = [];
  if (!root) return out;
  for (const path of root.querySelectorAll<SVGPathElement>(".react-flow__edge-path")) {
    const geometry = path.getAttribute("d");
    let cached = samples.get(path);
    if (!cached || cached.geometry !== geometry) {
      const edge = path.closest?.(".react-flow__edge")?.getAttribute("data-id") ?? undefined;
      const boxes: EdgeMark[] = [];
      const len = typeof path.getTotalLength === "function" ? path.getTotalLength() : 0;
      if (len > 0)
        for (let d = 0; d <= len; d += 24) {
          const p = path.getPointAtLength(d);
          boxes.push({ x: p.x - 2, y: p.y - 2, width: 4, height: 4, edge });
        }
      cached = { geometry, boxes };
      samples.set(path, cached);
    }
    out.push(...cached.boxes);
  }
  return out;
}
