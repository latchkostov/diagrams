import type { AnnotationShape } from "../../model/types";

export interface ShapePrimitive {
  tag: "rect" | "ellipse" | "line" | "polygon" | "path";
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rx?: number;
  ry?: number;
  cx?: number;
  cy?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  points?: string;
  d?: string;
  fill?: string;
  className?: string;
}

export { loadShapeGeometry, geometrySnapshot, subscribeGeometry, isDefaultShape } from "./runtime";
import { extendedGeometry, isDefaultShape } from "./runtime";

/** Keep the saved box while the extended catalog downloads; routing uses the same placeholder stroke. */
export function shapeGeometry(shape: AnnotationShape, w: number, h: number): ShapePrimitive[] {
  if (w <= 0 || h <= 0) return [];
  if (!isDefaultShape(shape) && extendedGeometry) return extendedGeometry(shape, w, h);
  const i = 0.75;
  let body: ShapePrimitive | ShapePrimitive[];
  switch (shape) {
    case "rounded":
      body = { tag: "rect", x: i, y: i, width: w - 2 * i, height: h - 2 * i, rx: Math.min(16, h / 3) };
      break;
    case "ellipse":
      body = { tag: "ellipse", cx: w / 2, cy: h / 2, rx: w / 2 - i, ry: h / 2 - i };
      break;
    case "diamond":
      body = { tag: "polygon", points: `${w / 2},${i} ${w - i},${h / 2} ${w / 2},${h - i} ${i},${h / 2}` };
      break;
    case "cylinder": {
      const rx = w / 2 - i;
      const ry = Math.min(14, h * 0.16);
      body = [
        {
          tag: "path",
          d: `M${i},${ry + i} V${h - ry - i} A${rx},${ry} 0 0 0 ${w - i},${h - ry - i} V${ry + i}`,
          className: "ann-shape-side",
        },
        { tag: "ellipse", cx: w / 2, cy: ry + i, rx: rx, ry: ry, className: "ann-shape-top" },
      ];
      break;
    }
    default:
      body = { tag: "rect", x: i, y: i, width: w - 2 * i, height: h - 2 * i, rx: 3 };
  }
  return Array.isArray(body) ? body : [body];
}
