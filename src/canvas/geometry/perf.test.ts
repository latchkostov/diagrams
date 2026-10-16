// Routing benchmark over the public examples, the obstacle course and the 150-node stress preset.
import { expect, it, vi } from "vitest";
import type { DiagramFile } from "../../model/types";
import { stressDiagram } from "../../lab/generators";
import { obstacleCourseDiagram } from "../../lab/routingDiagrams";
import { estimateCardSize } from "../nodes/size";
import { groupHeaderRect, Router, type RouteInput } from "./router";
import { routeOrthogonal } from "./orthogonal";
import { nudgeRoutes } from "./nudge";
import { growth, GROWTH_FACTOR, LINEAR_LIMIT } from "../../test/complexity";
import type { Point, Rect } from "./rect";

/**
 * Reads of the padded obstacles the router makes (every `inflate`d box), while `rectReads.on`; past `limit` the
 * read throws, so a runaway search fails at once instead of crawling through a billion counted reads.
 */
const rectReads = vi.hoisted(() => ({ on: false, count: 0, limit: Infinity }));
vi.mock("./rect", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./rect")>();
  return {
    ...actual,
    inflate: (...args: Parameters<typeof actual.inflate>) => {
      const box = actual.inflate(...args);
      if (!rectReads.on) return box;
      return new Proxy(box, {
        get(target, key, receiver) {
          if (++rectReads.count > rectReads.limit) throw new Error(`more than ${rectReads.limit} obstacle reads`);
          return Reflect.get(target, key, receiver) as unknown;
        },
      });
    },
  };
});

function offsetRoute(count: number) {
  const side = Math.sqrt(count);
  return routeOrthogonal({
    source: { x: 220, y: 36 },
    sourceDir: { x: 1, y: 0 },
    target: { x: (side - 1) * 400 + count * 2, y: (side - 1) * 140 + count * 2 + 36 },
    targetDir: { x: -1, y: 0 },
    obstacles: Array.from({ length: count }, (_, i) => ({
      x: (i % side) * 400 + i * 2,
      y: Math.floor(i / side) * 140 + i * 2,
      width: 220,
      height: 72,
    })),
  });
}

function separatedRoutes(count: number) {
  return new Map(
    Array.from({ length: count }, (_, i) => [
      `e${i}`,
      [
        { x: 0, y: i * 20 },
        { x: 1000, y: i * 20 },
      ],
    ]),
  );
}

it("routes distinct obstacle coordinates without rescanning obstacles per grid cell", () => {
  // Counted, not timed (the count doesn't depend on the machine): 400 obstacles at distinct coordinates make a grid
  // of about a million cells. The occupancy sweep reads each obstacle a few times, and the hugging penalty reads the
  // ones on a link's own ruler: about six million reads in all. Testing every obstacle at every cell the search
  // looks at would be over a billion.
  rectReads.on = true;
  rectReads.count = 0;
  rectReads.limit = 20_000_000;
  try {
    expect(offsetRoute(400).ok).toBe(true);
  } finally {
    rectReads.on = false;
  }
});

it("nudges separated pinned routes without an all-pairs pass", () => {
  // Eight times the routes against an eighth: sorting them is about 8 to 10 times the work, comparing every pair
  // 64. A ratio, not a budget in ms, so a busy machine doesn't fail it.
  const small = separatedRoutes(3_750);
  const large = separatedRoutes(3_750 * GROWTH_FACTOR);
  expect(nudgeRoutes(large, [])).toEqual(large);
  expect(
    growth(
      () => nudgeRoutes(small, []),
      () => nudgeRoutes(large, []),
      { samples: 3 },
    ),
  ).toBeLessThan(LINEAR_LIMIT);
});

/** Rects whose coordinate reads are counted (any property read), to count the obstacles a pass looks at. */
function countedRects(rects: Rect[]) {
  const reads = { count: 0 };
  const proxied = rects.map(
    (r) =>
      new Proxy(r, {
        get(target, key, receiver) {
          reads.count++;
          return Reflect.get(target, key, receiver) as unknown;
        },
      }),
  );
  return { rects: proxied, reads };
}

/** `bundles` pairs of routes, each pair sharing a vertical track (so nudging moves a segment), in a row along y. */
function bundledRoutes(bundles: number) {
  const routes = new Map<string, Point[]>();
  for (let i = 0; i < bundles; i++) {
    const y = i * 400;
    for (const [k, dy] of [0, 20].entries())
      routes.set(`b${i}-${k}`, [
        { x: 0, y: y + dy },
        { x: 300, y: y + dy },
        { x: 300, y: y + 200 + dy * 3 },
        { x: 600, y: y + 200 + dy * 3 },
      ]);
  }
  return routes;
}

it("nudges a segment reading only the obstacles near it, not every node of the diagram", () => {
  // Counted, not timed. 200 bundles each move a segment; 2,000 nodes sit beside them (none near a track). Testing every
  // node for every moved segment and every bundle's room reads each node hundreds of times; with the index, a node is
  // read when it's indexed and when it's near something that moves.
  const bundles = 200;
  const nodes: Rect[] = Array.from({ length: 2_000 }, (_, i) => ({
    x: 2_000 + (i % 40) * 260,
    y: Math.floor(i / 40) * 120,
    width: 220,
    height: 72,
  }));
  const { rects, reads } = countedRects(nodes);
  const out = nudgeRoutes(bundledRoutes(bundles), rects);
  // Each bundle was spread: its two middle segments sit apart.
  for (let i = 0; i < bundles; i++) expect(out.get(`b${i}-0`)![1].x).not.toBe(out.get(`b${i}-1`)![1].x);
  expect(reads.count / nodes.length).toBeLessThan(40);
  // The same routes and nodes, unproxied, nudge the same way.
  expect(nudgeRoutes(bundledRoutes(bundles), nodes)).toEqual(out);
});

const files = import.meta.glob<DiagramFile>("../../examples/*.json", { eager: true, import: "default" });
const inputFor = (d: DiagramFile): RouteInput => ({
  direction: d.direction ?? "LR",
  nodes: d.nodes.map((n) => ({ id: n.id, rect: { x: n.x, y: n.y, ...estimateCardSize(n.label, n.sublabel) } })),
  groups: (d.groups ?? []).map((g) => ({ id: g.id, rect: g, header: groupHeaderRect(g, g.label) })),
  edges: d.edges.map((e) => ({
    id: e.id,
    source: e.from,
    target: e.to,
    label: e.label,
    sourceSide: e.sourceSide,
    targetSide: e.targetSide,
  })),
});
function bench(name: string, d: DiagramFile) {
  const input = inputFor(d);
  for (let i = 0; i < 3; i++) new Router().route(input); // warm up
  let t = performance.now();
  const N = 10;
  for (let i = 0; i < N; i++) new Router().route(input);
  const full = (performance.now() - t) / N;
  const r = new Router();
  r.route(input);
  const id = input.nodes[Math.floor(input.nodes.length / 2)].id;
  t = performance.now();
  let routed = 0;
  for (let i = 1; i <= 30; i++) {
    r.route({
      ...input,
      nodes: input.nodes.map((n) =>
        n.id === id ? { ...n, rect: { ...n.rect, x: n.rect.x + i * 3, y: n.rect.y + i * 2 } } : n,
      ),
    });
    routed += r.lastRouted;
  }
  const drag = (performance.now() - t) / 30;
  console.log(
    `PERF ${name}: ${input.nodes.length} nodes, ${input.edges.length} edges | full ${full.toFixed(1)} ms | drag frame ${drag.toFixed(2)} ms (A* for ${(routed / 30).toFixed(1)} edges/frame)`,
  );
}
// Benchmark, not a check: ROUTE_BENCH=1 pnpm test src/canvas/geometry/perf --silent=false
it.skipIf(!process.env.ROUTE_BENCH)("routing benchmark", () => {
  for (const [p, d] of Object.entries(files)) bench(p.split("/").pop()!, d);
  bench("obstacle course", obstacleCourseDiagram());
  bench("stress 150", stressDiagram({ nodes: 150, seed: 1, density: 0.25, groups: false, direction: "LR" }));
  bench("stress 150 groups", stressDiagram({ nodes: 150, seed: 1, density: 0.25, groups: true, direction: "LR" }));
  for (const count of [144, 256, 400]) {
    const start = performance.now();
    offsetRoute(count);
    console.log(`PERF offset ${count}: ${(performance.now() - start).toFixed(2)} ms`);
  }
  for (const count of [1000, 2000, 20_000]) {
    const routes = separatedRoutes(count);
    const start = performance.now();
    nudgeRoutes(routes, []);
    console.log(`PERF separated ${count}: ${(performance.now() - start).toFixed(2)} ms`);
  }
});
