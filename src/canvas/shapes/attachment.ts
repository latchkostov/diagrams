import type { AnnotationShape, Side } from "../../model/types";
import type { Point } from "../geometry/rect";
import { shapeGeometry, type ShapePrimitive } from "./geometry";

const STEPS = 64;
const cache = new Map<string, Point[][]>();

/** Flatten the small, absolute SVG vocabulary used by the shape catalog. */
function pathPoints(d: string): Point[][] {
  const tokens = d.match(/[A-Z]|-?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) ?? [];
  const paths: Point[][] = [];
  let points: Point[] = [];
  let p = { x: 0, y: 0 };
  let control = p;
  let index = 0;
  const number = () => Number(tokens[index++]);
  const point = () => ({ x: number(), y: number() });
  const add = (next: Point) => {
    points.push(next);
    p = next;
  };
  while (index < tokens.length) {
    const command = tokens[index++];
    if (command === "M") {
      points = [];
      paths.push(points);
      add(point());
    } else if (command === "L") add(point());
    else if (command === "H") add({ x: number(), y: p.y });
    else if (command === "V") add({ x: p.x, y: number() });
    else if (command === "Z") add(points[0]);
    else if (command === "Q" || command === "T" || command === "C") {
      const start = p;
      const a = command === "T" ? { x: 2 * p.x - control.x, y: 2 * p.y - control.y } : point();
      const b = command === "C" ? point() : a;
      const end = point();
      for (let j = 1; j <= STEPS; j++) {
        const t = j / STEPS,
          u = 1 - t;
        add(
          command === "C"
            ? {
                x: u ** 3 * start.x + 3 * u * u * t * a.x + 3 * u * t * t * b.x + t ** 3 * end.x,
                y: u ** 3 * start.y + 3 * u * u * t * a.y + 3 * u * t * t * b.y + t ** 3 * end.y,
              }
            : {
                x: u * u * start.x + 2 * u * t * a.x + t * t * end.x,
                y: u * u * start.y + 2 * u * t * a.y + t * t * end.y,
              },
        );
      }
      control = b;
    } else if (command === "A") {
      const rx = number(),
        ry = number();
      number();
      number(); // All catalog arcs are unrotated half ellipses.
      const sweep = number();
      const start = p,
        end = point();
      const cx = (start.x + end.x) / 2,
        cy = (start.y + end.y) / 2;
      const angle = Math.atan2((start.y - cy) / ry, (start.x - cx) / rx);
      for (let j = 1; j <= STEPS; j++) {
        const t = angle + ((sweep ? 1 : -1) * Math.PI * j) / STEPS;
        add({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
      }
    } else throw new Error(`Unsupported shape command: ${command}`);
  }
  return paths;
}

function primitivePoints(p: ShapePrimitive): Point[][] {
  if (p.className === "ann-shape-fill-only") return [];
  if (p.tag === "path") return pathPoints(p.d!);
  if (p.tag === "polygon") {
    const values = p.points!.split(/[ ,]+/).map(Number);
    const points = values.flatMap((x, i) => (i % 2 ? [] : [{ x, y: values[i + 1] }]));
    return [[...points, points[0]]];
  }
  if (p.tag === "line")
    return [
      [
        { x: p.x1!, y: p.y1! },
        { x: p.x2!, y: p.y2! },
      ],
    ];
  if (p.tag === "ellipse")
    return [
      Array.from({ length: STEPS * 4 + 1 }, (_, j) => {
        const angle = (j * Math.PI) / (STEPS * 2);
        return { x: p.cx! + p.rx! * Math.cos(angle), y: p.cy! + p.ry! * Math.sin(angle) };
      }),
    ];
  const x = p.x!,
    y = p.y!,
    w = p.width!,
    h = p.height!;
  const rx = Math.min(p.rx ?? 0, w / 2, h / 2);
  if (!rx)
    return [
      [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
        { x, y },
      ],
    ];
  const points: Point[] = [];
  for (const [cx, cy, angle] of [
    [x + w - rx, y + rx, -Math.PI / 2],
    [x + w - rx, y + h - rx, 0],
    [x + rx, y + h - rx, Math.PI / 2],
    [x + rx, y + rx, Math.PI],
  ]) {
    for (let j = 0; j <= STEPS; j++)
      points.push({
        x: cx + rx * Math.cos(angle + (j * Math.PI) / (2 * STEPS)),
        y: cy + rx * Math.sin(angle + (j * Math.PI) / (2 * STEPS)),
      });
  }
  return [[...points, points[0]]];
}

/** Attach on the visible stroke, spreading along a scanline; open outlines use their nearest stroke. */
export function shapeAttachment(shape: AnnotationShape, w: number, h: number, side: Side, offset = 0): Point {
  const key = `${shape}|${w}|${h}`;
  let paths = cache.get(key);
  if (!paths) {
    paths = shapeGeometry(shape, w, h).flatMap(primitivePoints);
    if (cache.size >= 128) cache.delete(cache.keys().next().value!);
    cache.set(key, paths);
  }
  const vertical = side === "left" || side === "right";
  const target = vertical
    ? { x: side === "left" ? 0 : w, y: h / 2 + offset }
    : { x: w / 2 + offset, y: side === "top" ? 0 : h };
  const axis = vertical ? "y" : "x";
  const hits: Point[] = [];
  for (const points of paths)
    for (let j = 1; j < points.length; j++) {
      const a = points[j - 1],
        b = points[j];
      const length = b[axis] - a[axis];
      if (!length) {
        if (Math.abs(target[axis] - a[axis]) < 1e-8) hits.push(a, b);
        continue;
      }
      const t = (target[axis] - a[axis]) / length;
      if (t >= 0 && t <= 1) hits.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  const candidates = hits.length ? hits : paths.flat();
  return candidates.reduce(
    (best, p) =>
      Math.hypot(p.x - target.x, p.y - target.y) < Math.hypot(best.x - target.x, best.y - target.y) ? p : best,
    candidates[0] ?? target,
  );
}

const handleCache = new Map<string, Readonly<Record<Side, Point>>>();

/** Cache all four handles across selection and position renders; scan each opposite pair once. */
export function shapeHandles(shape: AnnotationShape, w: number, h: number): Readonly<Record<Side, Point>> {
  const key = `${shape}|${w}|${h}`;
  const cached = handleCache.get(key);
  if (cached) return cached;
  const handles = {
    left: shapeAttachment(shape, w, h, "left"),
    right: shapeAttachment(shape, w, h, "right"),
    top: shapeAttachment(shape, w, h, "top"),
    bottom: shapeAttachment(shape, w, h, "bottom"),
  };
  // Keep opposite handles distinct on pinched or open outlines, while staying on their stroke.
  for (const [a, b, spread] of [
    ["left", "right", h / 4],
    ["top", "bottom", w / 4],
  ] as const) {
    if (Math.hypot(handles[a].x - handles[b].x, handles[a].y - handles[b].y) >= 14) continue;
    handles[a] = shapeAttachment(shape, w, h, a, -spread);
    handles[b] = shapeAttachment(shape, w, h, b, spread);
  }
  if (handleCache.size >= 128) handleCache.delete(handleCache.keys().next().value!);
  handleCache.set(key, handles);
  return handles;
}

export function shapeHandle(shape: AnnotationShape, w: number, h: number, side: Side): Point {
  return shapeHandles(shape, w, h)[side];
}
