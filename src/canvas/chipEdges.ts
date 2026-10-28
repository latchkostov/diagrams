import { roundedPath } from "./geometry/path";
import type { Point } from "./geometry/rect";

/** Snap nearby, overlapping orthogonal lanes once per settled route layout. */
export function chipEdges(routes: Map<string, { points: Point[] }>, zoom: number) {
  const paths = [...routes].map(([id, r]) => ({ id, points: r.points.map((p) => ({ ...p })) }));
  type Segment = { id: string; points: Point[]; i: number; horizontal: boolean; c: number; lo: number; hi: number };
  const lanes = new Map<string, Set<string>>();
  const segments: Segment[] = [];
  for (const { id, points } of paths)
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i],
        b = points[i + 1];
      const horizontal = a.y === b.y;
      if (!horizontal && a.x !== b.x) continue;
      segments.push({
        id,
        points,
        i,
        horizontal,
        c: horizontal ? a.y : a.x,
        lo: Math.min(horizontal ? a.x : a.y, horizontal ? b.x : b.y),
        hi: Math.max(horizontal ? a.x : a.y, horizontal ? b.x : b.y),
      });
    }
  const tolerance = 7 / zoom;
  segments.sort((a, b) => Number(a.horizontal) - Number(b.horizontal) || a.c - b.c);
  const parents = segments.map((_, i) => i);
  const find = (i: number): number => {
    while (parents[i] !== i) {
      parents[i] = parents[parents[i]];
      i = parents[i];
    }
    return i;
  };
  for (let i = 0; i < segments.length; i++) {
    const a = segments[i];
    for (let j = i + 1; j < segments.length; j++) {
      const b = segments[j];
      if (b.horizontal !== a.horizontal || b.c - a.c > tolerance) break;
      if (Math.min(a.hi, b.hi) > Math.max(a.lo, b.lo)) parents[find(j)] = find(i);
    }
  }
  const groups = new Map<number, Segment[]>();
  for (const [i, segment] of segments.entries()) {
    const key = find(i),
      group = groups.get(key) ?? [];
    group.push(segment);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const total = group.reduce((n, s) => n + s.hi - s.lo, 0);
    const c = group.reduce((n, s) => n + s.c * (s.hi - s.lo), 0) / total;
    for (const s of group) {
      let shared = lanes.get(s.id);
      if (!shared) lanes.set(s.id, (shared = new Set()));
      for (const member of group) shared.add(member.id);
      const axis = s.horizontal ? "y" : "x";
      s.points[s.i][axis] = c;
      s.points[s.i + 1][axis] = c;
    }
  }
  const merged = new Map(
    paths.map(({ id, points }) => {
      const end = points.at(-1),
        prev = points.at(-2);
      let arrow = "";
      if (end && prev) {
        const length = Math.hypot(end.x - prev.x, end.y - prev.y);
        const size = Math.min(4.5 / zoom, length / 2);
        if (length) {
          const x = (end.x - prev.x) / length,
            y = (end.y - prev.y) / length;
          arrow = ` M${end.x - x * size - y * size * 0.6},${end.y - y * size + x * size * 0.6} L${end.x},${end.y} L${end.x - x * size + y * size * 0.6},${end.y - y * size - x * size * 0.6}`;
        }
      }
      return [id, roundedPath(points, 6 / zoom) + arrow];
    }),
  );
  return { paths: merged, lanes };
}
