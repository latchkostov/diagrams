import * as geometry from "./shaped";
// Routing benchmark over the public examples, the obstacle course and the 150-node stress preset.
import { expect, it, vi } from "vitest";
import type { DiagramFile } from "../../model/types";
import { stressDiagram } from "../../lab/generators";
import { obstacleCourseDiagram } from "../../lab/routingDiagrams";
import { estimateCardSize } from "../nodes/size";
import { groupHeaderRect, Router, type RouteInput } from "./router";
import { routeOrthogonal, SearchBuffers, type SoftLine } from "./orthogonal";
import { nudgeRoutes } from "./nudge";
import { GROWTH_FACTOR, LINEAR_LIMIT } from "../../test/complexity";
import type { Point, Rect } from "./rect";
import { RectIndex } from "./spatial";

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
  // Each segment's geometry and each candidate pair use Math.abs. Count those operations so
  // quota scheduling cannot turn a linear pass into a failing clock ratio; all-pairs still fails.
  const measure = (n: number, budget = n * LINEAR_LIMIT) => {
    const routes = separatedRoutes(n);
    const original = Math.abs;
    let operations = 0;
    const abs = vi.spyOn(Math, "abs").mockImplementation((value) => {
      if (++operations > budget) throw new Error("Pinned-route comparisons exceeded linear work limit");
      return original(value);
    });
    let out;
    try {
      out = nudgeRoutes(routes, []);
    } finally {
      abs.mockRestore();
    }
    expect(out).toEqual(routes);
    return operations;
  };
  const small = measure(3_750);
  const large = measure(3_750 * GROWTH_FACTOR, small * LINEAR_LIMIT);
  expect(small).toBeGreaterThan(0);
  expect(large / small).toBeLessThan(LINEAR_LIMIT);
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

it("routes an edge reading the obstacles near it, not every node of the diagram", () => {
  // Counted, not timed. A drag frame searches again for the few edges it moves; preparing each search padded and
  // tested every node in the diagram. With the router's index, a search reads the nodes near its own area.
  const nodes: Rect[] = Array.from({ length: 2_000 }, (_, i) => ({
    x: (i % 50) * 300,
    y: Math.floor(i / 50) * 160,
    width: 220,
    height: 72,
  }));
  const { rects, reads } = countedRects(nodes);
  const index = new RectIndex(rects);
  const indexing = reads.count;
  // A hundred short edges, each between two neighbours in a row.
  const requests = Array.from({ length: 100 }, (_, k) => {
    const i = (k % 40) * 50 + Math.floor(k / 40) * 7;
    return {
      source: { x: nodes[i].x + 220, y: nodes[i].y + 36 },
      sourceDir: { x: 1, y: 0 },
      target: { x: nodes[i + 1].x, y: nodes[i + 1].y + 36 },
      targetDir: { x: -1, y: 0 },
      obstacles: rects,
    };
  });
  const routed = requests.map((r) => routeOrthogonal({ ...r, index }));
  expect(routed.every((r) => r.ok)).toBe(true);
  expect((reads.count - indexing) / nodes.length).toBeLessThan(10);
  // The same routes without the index.
  expect(requests.map((r) => routeOrthogonal({ ...r, obstacles: nodes }))).toEqual(routed);
});

it("a link beside a column of aligned nodes doesn't test every node in the column", () => {
  // Counted, not timed. A link running along a ruler that padded borders lie on pays a "hugging" penalty if one of
  // them is beside it: each link tested every obstacle on its ruler, and a column of aligned nodes puts hundreds on
  // one. The ruler's borders are sorted spans now, tested by a binary search.
  const column = Array.from({ length: 300 }, (_, i) => ({ x: 0, y: i * 100, width: 200, height: 60 }));
  const request = {
    source: { x: 216, y: 30_100 },
    sourceDir: { x: 0, y: 1 },
    target: { x: 216, y: -100 },
    targetDir: { x: 0, y: -1 },
    obstacles: column,
  };
  rectReads.on = true;
  rectReads.count = 0;
  rectReads.limit = Infinity;
  let routed;
  try {
    routed = routeOrthogonal(request);
  } finally {
    rectReads.on = false;
  }
  expect(routed.ok).toBe(true);
  expect(rectReads.count / column.length).toBeLessThan(200);
});

it("a search reads the group borders near its grid, not every one in the diagram", () => {
  // Counted, not timed. A link's cost tested every group border (4 per boundary) for running along it: a diagram's
  // worth for every link the search looked at. 400 borders far from the edge, read at most a few times each.
  const reads = { count: 0 };
  const far: SoftLine[] = Array.from(
    { length: 400 },
    (_, i) =>
      new Proxy(
        { axis: i % 2 ? ("x" as const) : ("y" as const), at: 5_000 + i * 40, from: 5_000, to: 9_000 },
        {
          get(target, key, receiver) {
            reads.count++;
            return Reflect.get(target, key, receiver) as unknown;
          },
        },
      ),
  );
  // One border along the edge's way, so the penalty still applies where it should.
  const near: SoftLine = { axis: "y", at: 36, from: 0, to: 2_000 };
  const request = {
    source: { x: 220, y: 36 },
    sourceDir: { x: 1, y: 0 },
    target: { x: 1_200, y: 36 },
    targetDir: { x: -1, y: 0 },
    obstacles: [
      { x: 0, y: 0, width: 220, height: 72 },
      { x: 600, y: 0, width: 220, height: 72 },
      { x: 1_200, y: 0, width: 220, height: 72 },
    ],
  };
  const routed = routeOrthogonal({ ...request, soft: [...far, near] });
  expect(routed.ok).toBe(true);
  expect(reads.count / far.length).toBeLessThan(10);
  // The same route as with no far borders at all.
  expect(routeOrthogonal({ ...request, soft: [near] })).toEqual(routed);
});

it("a routing pass's searches share their scratch arrays", () => {
  // Each search allocated and filled arrays for its whole grid (four per cell and direction); the pass's searches
  // now share one set, grown a few times to the largest. Same routes as searches with arrays of their own.
  const input = inputFor(stressDiagram({ nodes: 150, seed: 1, density: 0.25, groups: true, direction: "LR" }));
  const router = new Router();
  SearchBuffers.allocations = 0;
  const routes = router.route(input);
  expect(router.lastRouted).toBeGreaterThan(100);
  expect(SearchBuffers.allocations).toBeLessThan(20);
  const shared = new SearchBuffers();
  const requests = [...routes.values()].slice(0, 40).map((r) => ({
    source: r.points[0],
    sourceDir: { x: 1, y: 0 },
    target: r.points[r.points.length - 1],
    targetDir: { x: -1, y: 0 },
    obstacles: input.nodes.map((n) => n.rect),
  }));
  expect(requests.map((q) => routeOrthogonal({ ...q, buffers: shared }))).toEqual(
    requests.map((q) => routeOrthogonal(q)),
  );
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

it("routes 300 saved and 300 automatic edges with searches only for automatic edges", () => {
  const nodes = Array.from({ length: 600 }, (_, i) => ({
    id: `n${i}`,
    rect: { x: (i % 2) * 600, y: Math.floor(i / 2) * 240, width: 220, height: 72 },
  }));
  const edges = Array.from({ length: 300 }, (_, i) => ({
    id: `auto${i}`,
    source: `n${i * 2}`,
    target: `n${i * 2 + 1}`,
  }));
  const custom = edges.map((e, i) => ({
    ...e,
    id: `saved${i}`,
    waypoints: [
      { x: 110, y: i * 240 + 140 },
      { x: 710, y: i * 240 + 140 },
    ],
  }));
  const router = new Router();
  const result = router.route({ geometry, nodes, edges: [...edges, ...custom] });
  expect(result.size).toBe(600);
  expect(router.lastRouted).toBe(300);
  for (const e of custom) expect(result.get(e.id)?.custom).toBe(true);
  router.route({ geometry, nodes, edges: [...edges, ...custom] });
  expect(router.lastRouted).toBe(0);
});

for (const mixed of [false, true])
  it(`bounds clustering work for many fixed saved routes (${mixed ? "mixed" : "all fixed"})`, () => {
    const measure = (count: number, budget = count * 64 * LINEAR_LIMIT) => {
      const routes = new Map(
        Array.from({ length: count }, (_, i) => [
          String(i),
          Array.from({ length: 64 }, (_, k) => ({
            x: k % 4 < 2 ? 0 : 100,
            y: i * 1000 + Math.floor((k + 1) / 2) * 10,
          })),
        ]),
      );
      const fixed = new Set(routes.keys());
      if (mixed)
        routes.set("auto", [
          { x: 0, y: -1000 },
          { x: 100, y: -1000 },
        ]);
      const min = Math.min;
      let countOps = 0;
      const spy = vi.spyOn(Math, "min").mockImplementation((...args) => {
        if (++countOps > budget) throw new Error("Saved-route clustering exceeded linear work");
        return min(...args);
      });
      try {
        expect(nudgeRoutes(routes, [], { fixed }).get("0")).toEqual(routes.get("0"));
      } finally {
        spy.mockRestore();
      }
      return countOps;
    };
    const small = measure(100);
    const large = measure(100 * GROWTH_FACTOR, Math.max(1, small) * LINEAR_LIMIT);
    expect(large).toBeLessThanOrEqual(Math.max(1, small) * LINEAR_LIMIT);
  });
