import { roundedPath } from "./geometry/path";
import type { Point } from "./geometry/rect";
import type { SharedChip } from "./lowZoom";

/** Snap nearby, overlapping orthogonal lanes once per settled route layout. */
export function chipEdges(routes: Map<string, { points: Point[] }>, zoom: number) {
  const paths = [...routes].map(([id, r]) => ({ id, points: r.points.map((p) => ({ ...p })) }));
  type Segment = { id: string; points: Point[]; i: number; horizontal: boolean; c: number; lo: number; hi: number };
  const lanes = new Map<string, string>();
  const segments: Segment[] = [];
  for (const { id, points } of paths)
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i],
        b = points[i + 1];
      const horizontal = a.y === b.y;
      if ((!horizontal && a.x !== b.x) || (a.x === b.x && a.y === b.y)) continue;
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
  // Sweep along each axis. Concurrent intervals need only their two nearest lanes:
  // every other nearby lane is already connected through those neighbours. A Fenwick
  // index keeps insertion, removal and neighbour lookup logarithmic, even for 20k
  // coincident imported edges. End events precede starts (touching isn't overlap).
  const tree = new Int32Array(segments.length + 1);
  const count = (end: number) => {
    let sum = 0;
    for (; end > 0; end -= end & -end) sum += tree[end];
    return sum;
  };
  const at = (order: number) => {
    let index = 0;
    for (let bit = 2 ** Math.floor(Math.log2(tree.length)); bit; bit >>= 1) {
      const next = index + bit;
      if (next < tree.length && tree[next] < order) {
        index = next;
        order -= tree[next];
      }
    }
    return index;
  };
  for (const horizontal of [false, true]) {
    const events = segments.flatMap((s, i) =>
      s.horizontal === horizontal
        ? [
            { x: s.lo, i, delta: 1 },
            { x: s.hi, i, delta: -1 },
          ]
        : [],
    );
    events.sort((a, b) => a.x - b.x || a.delta - b.delta);
    let active = 0;
    for (const { i, delta } of events) {
      if (delta > 0) {
        const before = count(i);
        for (const order of [before, before + 1]) {
          if (order < 1 || order > active) continue;
          const j = at(order);
          if (Math.abs(segments[j].c - segments[i].c) <= tolerance) parents[find(j)] = find(i);
        }
      }
      for (let k = i + 1; k < tree.length; k += k & -k) tree[k] += delta;
      active += delta;
    }
  }
  const groups = new Map<number, Segment[]>();
  for (const [i, segment] of segments.entries()) {
    const key = find(i),
      group = groups.get(key) ?? [];
    group.push(segment);
    groups.set(key, group);
  }
  const shared = new Map<string, SharedChip[]>();
  // Bound member storage for adversarial staggered intervals as well as coincident lanes.
  let remaining = segments.length * 32;
  // An edge can traverse multiple merged segments. Union its component references
  // too, retaining exactly one group id per edge rather than copying member lists.
  const edgeParents = new Map(paths.map(({ id }) => [id, id]));
  const edgeGroup = (id: string): string => {
    let root = id;
    while (edgeParents.get(root) !== root) root = edgeParents.get(root)!;
    while (id !== root) {
      const next = edgeParents.get(id)!;
      edgeParents.set(id, root);
      id = next;
    }
    return root;
  };
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const total = group.reduce((n, s) => n + s.hi - s.lo, 0);
    const c = group.reduce((n, s) => n + s.c * (s.hi - s.lo), 0) / total;
    for (const s of group) {
      edgeParents.set(edgeGroup(s.id), edgeGroup(group[0].id));
      const axis = s.horizontal ? "y" : "x";
      s.points[s.i][axis] = c;
      s.points[s.i + 1][axis] = c;
    }
    // Split at every endpoint: a member contributes only along the interval it traverses.
    const events = group.flatMap((s) => [
      { x: s.lo, id: s.id, delta: 1 },
      { x: s.hi, id: s.id, delta: -1 },
    ]);
    events.sort((a, b) => a.x - b.x);
    const active = new Map<string, number>();
    let start = events[0].x;
    for (const { x, id, delta } of events) {
      if (x > start && active.size > 1 && remaining >= active.size) {
        const members = [...active.keys()];
        remaining -= members.length;
        const owner = members[0];
        const sections = shared.get(owner) ?? [];
        const point = (v: number) => (group[0].horizontal ? `${v},${c}` : `${c},${v}`);
        sections.push({ path: `M${point(start)} L${point(x)}`, members });
        shared.set(owner, sections);
      }
      const count = (active.get(id) ?? 0) + delta;
      if (count) active.set(id, count);
      else active.delete(id);
      start = x;
    }
  }
  for (const { id } of paths) lanes.set(id, edgeGroup(id));
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
  return { paths: merged, lanes, shared };
}
