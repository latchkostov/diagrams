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

function leftBracePath(x0: number, y0: number, y1: number, bw: number): string {
  const ym = (y0 + y1) / 2;
  const th = Math.min(18, (y1 - y0) * 0.15);
  const hh = Math.min(18, (y1 - y0) * 0.15);
  const xs = x0 + bw * 0.5;
  const xt = x0;
  const xh = x0 + bw;
  return [
    `M${xh},${y0}`,
    `C${xs + (xh - xs) * 0.2},${y0} ${xs},${y0 + hh * 0.5} ${xs},${y0 + hh}`,
    `V${ym - th}`,
    `C${xs},${ym - th * 0.4} ${xt},${ym - th * 0.2} ${xt},${ym}`,
    `C${xt},${ym + th * 0.2} ${xs},${ym + th * 0.4} ${xs},${ym + th}`,
    `V${y1 - hh}`,
    `C${xs},${y1 - hh * 0.5} ${xs + (xh - xs) * 0.2},${y1} ${xh},${y1}`,
  ].join(" ");
}

function rightBracePath(x1: number, y0: number, y1: number, bw: number): string {
  const ym = (y0 + y1) / 2;
  const th = Math.min(18, (y1 - y0) * 0.15);
  const hh = Math.min(18, (y1 - y0) * 0.15);
  const xs = x1 - bw * 0.5;
  const xt = x1;
  const xh = x1 - bw;
  return [
    `M${xh},${y0}`,
    `C${xs - (xs - xh) * 0.2},${y0} ${xs},${y0 + hh * 0.5} ${xs},${y0 + hh}`,
    `V${ym - th}`,
    `C${xs},${ym - th * 0.4} ${xt},${ym - th * 0.2} ${xt},${ym}`,
    `C${xt},${ym + th * 0.2} ${xs},${ym + th * 0.4} ${xs},${ym + th}`,
    `V${y1 - hh}`,
    `C${xs},${y1 - hh * 0.5} ${xs - (xs - xh) * 0.2},${y1} ${xh},${y1}`,
  ].join(" ");
}

/** Outlines drawn at the node's real pixel size, so strokes and corners stay crisp at any size. */
export function shapeGeometry(shape: AnnotationShape, w: number, h: number): ShapePrimitive[] {
  if (w <= 0 || h <= 0) return [];
  const i = 0.75;
  let body: ShapePrimitive | ShapePrimitive[];
  switch (shape) {
    case "rounded":
      body = { tag: "rect", x: i, y: i, width: w - 2 * i, height: h - 2 * i, rx: Math.min(16, h / 3) };
      break;
    case "stadium":
      body = {
        tag: "rect",
        x: i,
        y: i,
        width: w - 2 * i,
        height: h - 2 * i,
        rx: Math.min((h - 2 * i) / 2, (w - 2 * i) / 2),
      };
      break;
    case "subroutine": {
      const sx = Math.min(16, w * 0.12);
      body = [
        { tag: "rect", x: i, y: i, width: w - 2 * i, height: h - 2 * i, rx: 3 },
        { tag: "line", x1: sx, y1: i, x2: sx, y2: h - i },
        { tag: "line", x1: w - sx, y1: i, x2: w - sx, y2: h - i },
      ];
      break;
    }
    case "ellipse":
      body = { tag: "ellipse", cx: w / 2, cy: h / 2, rx: w / 2 - i, ry: h / 2 - i };
      break;
    case "dbl-circ": {
      const offset = Math.min(5, Math.min(w, h) * 0.08);
      body = [
        { tag: "ellipse", cx: w / 2, cy: h / 2, rx: w / 2 - i, ry: h / 2 - i },
        {
          tag: "ellipse",
          cx: w / 2,
          cy: h / 2,
          rx: Math.max(2, w / 2 - i - offset),
          ry: Math.max(2, h / 2 - i - offset),
        },
      ];
      break;
    }
    case "diamond":
      body = { tag: "polygon", points: `${w / 2},${i} ${w - i},${h / 2} ${w / 2},${h - i} ${i},${h / 2}` };
      break;
    case "hexagon": {
      const hx = Math.min(w * 0.18, 28);
      body = {
        tag: "polygon",
        points: `${hx},${i} ${w - hx},${i} ${w - i},${h / 2} ${w - hx},${h - i} ${hx},${h - i} ${i},${h / 2}`,
      };
      break;
    }
    case "lean-r": {
      const sl = Math.min(w * 0.18, 28);
      body = { tag: "polygon", points: `${sl},${i} ${w - i},${i} ${w - sl},${h - i} ${i},${h - i}` };
      break;
    }
    case "lean-l": {
      const sl = Math.min(w * 0.18, 28);
      body = { tag: "polygon", points: `${i},${i} ${w - sl},${i} ${w - i},${h - i} ${sl},${h - i}` };
      break;
    }
    case "trap-b": {
      const tb = Math.min(w * 0.18, 28);
      body = { tag: "polygon", points: `${tb},${i} ${w - tb},${i} ${w - i},${h - i} ${i},${h - i}` };
      break;
    }
    case "trap-t": {
      const tb = Math.min(w * 0.18, 28);
      body = { tag: "polygon", points: `${i},${i} ${w - i},${i} ${w - tb},${h - i} ${tb},${h - i}` };
      break;
    }
    case "sl-rect": {
      const sy = Math.min(h * 0.25, 20);
      body = { tag: "polygon", points: `${i},${sy} ${w - i},${i} ${w - i},${h - i} ${i},${h - i}` };
      break;
    }
    case "notch-rect": {
      const cn = Math.min(16, w * 0.15, h * 0.25);
      body = { tag: "polygon", points: `${i},${i} ${w - cn},${i} ${w - i},${cn} ${w - i},${h - i} ${i},${h - i}` };
      break;
    }
    case "lin-rect": {
      const ly = Math.min(16, h * 0.22);
      body = [
        { tag: "rect", x: i, y: i, width: w - 2 * i, height: h - 2 * i, rx: 3 },
        { tag: "line", x1: i, y1: ly, x2: w - i, y2: ly },
      ];
      break;
    }
    case "div-rect": {
      const dy = Math.min(20, h * 0.28);
      body = [
        { tag: "rect", x: i, y: i, width: w - 2 * i, height: h - 2 * i, rx: 3 },
        { tag: "line", x1: i, y1: dy, x2: w - i, y2: dy },
      ];
      break;
    }
    case "tag-rect": {
      const tw = Math.min(w * 0.35, 40);
      const th = Math.min(12, h * 0.2);
      body = { tag: "path", d: `M${i},${th + i} V${h - i} H${w - i} V${th + i} H${tw} L${tw - 4},${i} H${i} Z` };
      break;
    }
    case "processes": {
      const offset = 6;
      body = [
        { tag: "rect", x: i + offset, y: i, width: w - 2 * i - offset, height: h - 2 * i - offset, rx: 3 },
        { tag: "rect", x: i, y: i + offset, width: w - 2 * i - offset, height: h - 2 * i - offset, rx: 3 },
      ];
      break;
    }
    case "delay": {
      const dr = Math.min((h - 2 * i) / 2, (w - 2 * i) * 0.4);
      body = {
        tag: "path",
        d: `M${i},${i} H${w - dr - i} A${dr},${(h - 2 * i) / 2} 0 0 1 ${w - dr - i},${h - i} H${i} Z`,
      };
      break;
    }
    case "notch-pent": {
      const py = Math.min(16, h * 0.25);
      body = { tag: "polygon", points: `${i},${py} ${w / 2},${i} ${w - i},${py} ${w - i},${h - i} ${i},${h - i}` };
      break;
    }
    case "hourglass":
      body = { tag: "polygon", points: `${i},${i} ${w - i},${i} ${i},${h - i} ${w - i},${h - i}` };
      break;
    case "fork":
      body = { tag: "rect", x: i, y: i, width: w - 2 * i, height: h - 2 * i, rx: 2, className: "ann-shape-top" };
      break;
    case "datastore":
      body = [
        { tag: "rect", x: i, y: i, width: w - 2 * i, height: h - 2 * i, className: "ann-shape-fill-only" },
        { tag: "line", x1: i, y1: i, x2: w - i, y2: i },
        { tag: "line", x1: i, y1: h - i, x2: w - i, y2: h - i },
      ];
      break;
    case "das": {
      const drx = Math.min(16, w * 0.15);
      const ry = h / 2 - i;
      body = [
        {
          tag: "path",
          d: `M${drx + i},${i} H${w - drx - i} A${drx},${ry} 0 0 1 ${w - drx - i},${h - i} H${drx + i} A${drx},${ry} 0 0 1 ${drx + i},${i} Z`,
        },
        { tag: "path", d: `M${w - drx - i},${i} A${drx},${ry} 0 0 0 ${w - drx - i},${h - i}` },
      ];
      break;
    }
    case "lin-cyl": {
      const rx = w / 2 - i;
      const ry = Math.min(14, h * 0.16);
      const lineY1 = h * 0.45;
      const lineY2 = h * 0.7;
      body = [
        {
          tag: "path",
          d: `M${i},${ry + i} V${h - ry - i} A${rx},${ry} 0 0 0 ${w - i},${h - ry - i} V${ry + i}`,
          className: "ann-shape-side",
        },
        { tag: "ellipse", cx: w / 2, cy: ry + i, rx: rx, ry: ry, className: "ann-shape-top" },
        { tag: "path", d: `M${i},${lineY1} A${rx},${ry} 0 0 0 ${w - i},${lineY1}` },
        { tag: "path", d: `M${i},${lineY2} A${rx},${ry} 0 0 0 ${w - i},${lineY2}` },
      ];
      break;
    }
    case "bow-rect": {
      const bw = Math.min(16, w * 0.15);
      body = {
        tag: "polygon",
        points: `${i},${i} ${w - i},${i} ${w - bw},${h / 2} ${w - i},${h - i} ${i},${h - i} ${bw},${h / 2}`,
      };
      break;
    }
    case "flag": {
      const fw = Math.min(16, w * 0.15);
      body = { tag: "polygon", points: `${i},${i} ${w - i},${i} ${w - fw},${h / 2} ${w - i},${h - i} ${i},${h - i}` };
      break;
    }
    case "win-pane":
      body = [
        { tag: "rect", x: i, y: i, width: w - 2 * i, height: h - 2 * i, rx: 2 },
        { tag: "line", x1: w * 0.2, y1: i, x2: w * 0.2, y2: h - i },
        { tag: "line", x1: i, y1: h * 0.2, x2: w - i, y2: h * 0.2 },
      ];
      break;
    case "doc": {
      const wave = Math.min(12, h * 0.14);
      body = {
        tag: "path",
        d: `M${i},${i} H${w - i} V${h - wave - i} Q${w * 0.75},${h - 2 * wave} ${w / 2},${h - wave - i} T${i},${h - wave - i} Z`,
      };
      break;
    }
    case "docs": {
      const wave = Math.min(12, h * 0.14);
      const off = 5;
      body = [
        {
          tag: "path",
          d: `M${i + off},${i} H${w - i} V${h - wave - off} Q${(w - off) * 0.75 + off},${h - 2 * wave} ${(w - off) / 2 + off},${h - wave - off} T${i + off},${h - wave - off} Z`,
        },
        {
          tag: "path",
          d: `M${i},${i + off} H${w - i - off} V${h - wave - i} Q${(w - off) * 0.75},${h - 2 * wave + off} ${(w - off) / 2},${h - wave - i} T${i},${h - wave - i} Z`,
        },
      ];
      break;
    }
    case "lin-doc": {
      const wave = Math.min(12, h * 0.14);
      body = [
        {
          tag: "path",
          d: `M${i},${i} H${w - i} V${h - wave - i} Q${w * 0.75},${h - 2 * wave} ${w / 2},${h - wave - i} T${i},${h - wave - i} Z`,
        },
        { tag: "line", x1: i + 12, y1: h * 0.28, x2: w - i - 12, y2: h * 0.28 },
        { tag: "line", x1: i + 12, y1: h * 0.45, x2: w - i - 12, y2: h * 0.45 },
      ];
      break;
    }
    case "tag-doc": {
      const wave = Math.min(12, h * 0.14);
      const tagW = Math.min(16, w * 0.2);
      body = [
        {
          tag: "path",
          d: `M${i},${i} H${w - i} V${h - wave - i} Q${w * 0.75},${h - 2 * wave} ${w / 2},${h - wave - i} T${i},${h - wave - i} Z`,
        },
        { tag: "path", d: `M${w - tagW - i},${i} V${tagW + i} H${w - i}` },
      ];
      break;
    }
    case "bolt": {
      const midY = h * 0.5;
      body = {
        tag: "polygon",
        points: `${w * 0.68},${i} ${i},${midY + 2} ${w * 0.55},${midY + 2} ${w * 0.32},${h - i} ${w - i},${midY - 2} ${w * 0.45},${midY - 2}`,
      };
      break;
    }
    case "comment": {
      const bw = Math.min(24, Math.max(12, Math.min(w * 0.2, h * 0.25)));
      body = { tag: "path", d: leftBracePath(i, i, h - i, bw), fill: "none", className: "ann-shape-stroke-only" };
      break;
    }
    case "brace-r": {
      const bw = Math.min(24, Math.max(12, Math.min(w * 0.2, h * 0.25)));
      body = { tag: "path", d: rightBracePath(w - i, i, h - i, bw), fill: "none", className: "ann-shape-stroke-only" };
      break;
    }
    case "braces": {
      const bw = Math.min(20, Math.max(10, Math.min(w * 0.15, h * 0.25)));
      body = [
        { tag: "path", d: leftBracePath(i, i, h - i, bw), fill: "none", className: "ann-shape-stroke-only" },
        { tag: "path", d: rightBracePath(w - i, i, h - i, bw), fill: "none", className: "ann-shape-stroke-only" },
      ];
      break;
    }
    case "curv-trap": {
      const crx = Math.min(20, w * 0.18);
      body = {
        tag: "path",
        d: `M${crx + i},${i} H${w - crx - i} L${w - i},${h - i} H${crx + i} Q${i},${h / 2} ${crx + i},${i} Z`,
      };
      break;
    }
    case "asym": {
      const aw = Math.min(20, w * 0.18);
      body = { tag: "polygon", points: `${i},${i} ${w - aw},${i} ${w - i},${h / 2} ${w - aw},${h - i} ${i},${h - i}` };
      break;
    }
    case "f-circ":
      body = { tag: "ellipse", cx: w / 2, cy: h / 2, rx: w / 2 - i, ry: h / 2 - i, className: "ann-shape-top" };
      break;
    case "framed-circle": {
      const fr = Math.min(w / 2 - i, h / 2 - i);
      body = [
        { tag: "rect", x: i, y: i, width: w - 2 * i, height: h - 2 * i, rx: 3 },
        { tag: "ellipse", cx: w / 2, cy: h / 2, rx: fr * 0.75, ry: fr * 0.75 },
      ];
      break;
    }
    case "cross-circ": {
      const rx = w / 2 - i;
      const ry = h / 2 - i;
      const offX = rx * 0.7;
      const offY = ry * 0.7;
      body = [
        { tag: "ellipse", cx: w / 2, cy: h / 2, rx: rx, ry: ry },
        { tag: "line", x1: w / 2 - offX, y1: h / 2 - offY, x2: w / 2 + offX, y2: h / 2 + offY },
        { tag: "line", x1: w / 2 + offX, y1: h / 2 - offY, x2: w / 2 - offX, y2: h / 2 + offY },
      ];
      break;
    }
    case "tri":
      body = { tag: "polygon", points: `${w / 2},${i} ${w - i},${h - i} ${i},${h - i}` };
      break;
    case "flip-tri":
      body = { tag: "polygon", points: `${i},${i} ${w - i},${i} ${w / 2},${h - i}` };
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
