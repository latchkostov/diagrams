import * as geometry from "./shaped";
import { describe, expect, it, vi } from "vitest";
import { auditLayout, countViolations } from "./audit";
import { fitAvoiding } from "./fit";
import { LABEL, pillWidth, placeLabels, wrapLines } from "./labels";
import { nudgeRoutes } from "./nudge";
import { pointAlong, roundedPath } from "./path";
import { sidePoint, slotOffset, spreadPorts } from "./ports";
import { intersects, segmentHitsRect, simplify, type Point, type Rect } from "./rect";
import { Router, groupHeaderRect, routeDiagram, type RouteInput } from "./router";
import { overlapsSpan, routeOrthogonal, spansOf, type SoftLine } from "./orthogonal";

// The router's A* searches, counted (the real search runs).
vi.mock("./orthogonal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./orthogonal")>();
  return { ...actual, routeOrthogonal: vi.fn(actual.routeOrthogonal) };
});

const card = (x: number, y: number, width = 220, height = 72): Rect => ({ x, y, width, height });
const boxOf = (l: { x: number; y: number; width: number; height: number }): Rect => ({
  x: l.x - l.width / 2,
  y: l.y - l.height / 2,
  width: l.width,
  height: l.height,
});

describe("rect helpers", () => {
  it("segmentHitsRect ignores borders and catches crossings", () => {
    const r = card(0, 0, 100, 100);
    expect(segmentHitsRect({ x: -10, y: 50 }, { x: 110, y: 50 }, r)).toBe(true);
    expect(segmentHitsRect({ x: -10, y: 0 }, { x: 110, y: 0 }, r)).toBe(false); // along the border
    expect(segmentHitsRect({ x: 100, y: 50 }, { x: 200, y: 50 }, r)).toBe(false); // starts on the border, goes out
    expect(segmentHitsRect({ x: -10, y: -10 }, { x: 50, y: 50 }, r)).toBe(true); // diagonal
  });
  it("simplify drops duplicates and collinear points", () => {
    expect(
      simplify([
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 5 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
    ]);
  });
});

describe("ports", () => {
  it("spreads ends on one side, ordered by where they head", () => {
    const rects = new Map([
      ["hub", card(0, 100)],
      ["up", card(400, 0)],
      ["mid", card(400, 100)],
      ["down", card(400, 200)],
    ]);
    const p = spreadPorts(
      ["down", "up", "mid"].map((t) => ({
        key: t,
        node: "hub",
        side: "right" as const,
        toward: { x: 510, y: rects.get(t)!.y + 36 },
        order: t,
      })),
      rects,
      14,
    );
    expect(p.get("up")!.attachment.y).toBeLessThan(p.get("mid")!.attachment.y);
    expect(p.get("mid")!.attachment.y).toBeLessThan(p.get("down")!.attachment.y);
    expect(p.get("mid")?.attachment).toEqual({ x: 220, y: 136 });
    expect(p.get("down")!.attachment.y - p.get("mid")!.attachment.y).toBe(14);
  });
  it("compresses spacing to fit the side, clear of the corners", () => {
    expect(slotOffset(0, 1, 72, 14)).toBe(0);
    const n = 8;
    const first = slotOffset(0, n, 72, 14),
      last = slotOffset(n - 1, n, 72, 14);
    expect(last - first).toBeLessThanOrEqual(72 - 20);
  });
});

describe("nudgeRoutes", () => {
  it("separates interior segments that share a track", () => {
    // Two edges with a vertical run on x = 300 over overlapping spans.
    const routes = new Map<string, Point[]>([
      [
        "a",
        [
          { x: 220, y: 30 },
          { x: 300, y: 30 },
          { x: 300, y: 300 },
          { x: 400, y: 300 },
        ],
      ],
      [
        "b",
        [
          { x: 220, y: 50 },
          { x: 300, y: 50 },
          { x: 300, y: 400 },
          { x: 400, y: 400 },
        ],
      ],
    ]);
    const out = nudgeRoutes(routes, [card(0, 0), card(400, 264), card(400, 364)], { separation: 10 });
    const xa = out.get("a")![1].x,
      xb = out.get("b")![1].x;
    expect(Math.abs(xa - xb)).toBeCloseTo(10);
    // a turns off first (at y=300) toward +x, so it takes the right-hand lane: no crossing.
    expect(xa).toBeGreaterThan(xb);
    // Pinned first / last segments keep their ports.
    expect(out.get("a")![0]).toEqual({ x: 220, y: 30 });
    expect(out.get("b")![3]).toEqual({ x: 400, y: 400 });
  });
  it("reorders bends so two port stubs on one line don't overlap", () => {
    // a enters a node at y=1149 after a bend at x=1399; b leaves the facing node at y=1149 and bends at x=1421.
    const routes = new Map<string, Point[]>([
      [
        "a",
        [
          { x: 1340, y: 923 },
          { x: 1399, y: 923 },
          { x: 1399, y: 1149 },
          { x: 1480, y: 1149 },
        ],
      ],
      [
        "b",
        [
          { x: 1340, y: 1149 },
          { x: 1421, y: 1149 },
          { x: 1421, y: 1043 },
          { x: 1480, y: 1043 },
        ],
      ],
    ]);
    const out = nudgeRoutes(routes, [card(1120, 887), card(1120, 1113), card(1480, 1007), card(1480, 1113)]);
    const aStart = out.get("a")![2].x; // a's last stub spans [aStart, 1480]
    const bEnd = out.get("b")![1].x; // b's first stub spans [1340, bEnd]
    expect(bEnd).toBeLessThan(aStart);
  });

  // Two routes sharing a track at 300 (the first test's), with a node beside it or across it, in both orientations: the
  // horizontal case is the same diagram with x and y swapped.
  const flip = {
    p: (q: Point): Point => ({ x: q.y, y: q.x }),
    r: (r: Rect): Rect => ({ x: r.y, y: r.x, width: r.height, height: r.width }),
  };
  const same = { p: (q: Point) => q, r: (r: Rect) => r };
  const sharedTrack = (t: typeof same) =>
    new Map<string, Point[]>([
      [
        "a",
        [
          { x: 220, y: 30 },
          { x: 300, y: 30 },
          { x: 300, y: 300 },
          { x: 400, y: 300 },
        ].map(t.p),
      ],
      [
        "b",
        [
          { x: 220, y: 50 },
          { x: 300, y: 50 },
          { x: 300, y: 400 },
          { x: 400, y: 400 },
        ].map(t.p),
      ],
    ]);
  const ends = [card(0, 0), card(400, 264), card(400, 364)];
  for (const [name, t, key] of [
    ["vertical", same, "x"],
    ["horizontal", flip, "y"],
  ] as const) {
    it(`narrows a ${name} bundle beside a node, so neither line reaches it`, () => {
      // 4 px of room on the right of the track: the lines step 4 apart (298 and 302), not 11.
      const wall = { x: 304, y: 120, width: 60, height: 60 };
      const out = nudgeRoutes(sharedTrack(t), [...ends, wall].map(t.r));
      expect([out.get("a")![1][key], out.get("b")![1][key]]).toEqual([302, 298]);
      for (const pts of out.values())
        for (let i = 1; i < pts.length; i++) expect(segmentHitsRect(pts[i - 1], pts[i], t.r(wall))).toBe(false);
    });
    it(`never moves a ${name} line further into a node it crosses`, () => {
      // A node across the track (the route's fallback elbow can cross one): both spread slots are inside it, so
      // neither line moves.
      const across = { x: 295, y: 150, width: 25, height: 10 };
      const out = nudgeRoutes(sharedTrack(t), [...ends, across].map(t.r));
      expect([out.get("a")![1][key], out.get("b")![1][key]]).toEqual([300, 300]);
    });
  }

  it("leaves lone segments alone", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ];
    expect(nudgeRoutes(new Map([["a", pts]]), []).get("a")).toEqual(pts);
  });
});

describe("labels", () => {
  it("wraps on words, as narrow as possible", () => {
    expect(wrapLines("Authorize payment", 2)).toEqual(["Authorize", "payment"]);
    expect(wrapLines("single", 2)).toBeNull();
    expect(wrapLines("Redrive after 5 failed receives", 2)).toEqual(["Redrive after 5", "failed receives"]);
  });

  it("puts the pill on the longest segment, clear of nodes", () => {
    const route = [
      { x: 220, y: 36 },
      { x: 260, y: 36 },
      { x: 260, y: 300 },
      { x: 400, y: 300 },
    ];
    const nodes = [card(0, 0), card(400, 264)];
    const pl = placeLabels([{ id: "e", text: "Reserve", points: route }], { nodes }).get("e")!;
    expect(pl.mode).toBe("full");
    expect(pl.x).toBeCloseTo(260); // on the long vertical run
    expect(nodes.some((n) => intersects(boxOf(pl), n))).toBe(false);
  });

  it("falls back to wrap, then truncate, then a numbered dot", () => {
    // A 100px-wide channel between two tall nodes with a vertical route down the middle.
    const nodes = [card(0, -500, 220, 1200), card(320, -500, 220, 1200)];
    const route = [
      { x: 270, y: 0 },
      { x: 270, y: 200 },
    ];
    const out = placeLabels(
      [
        { id: "wrap", text: "Authorize payment", points: route },
        {
          id: "trunc",
          text: "Supercalifragilisticexpialidocious",
          points: [
            { x: 270, y: 300 },
            { x: 270, y: 400 },
          ],
        },
      ],
      { nodes },
    );
    expect(out.get("wrap")!.mode).toBe("wrap");
    expect(out.get("trunc")!.mode).toBe("truncate");
    expect(out.get("trunc")!.width).toBeLessThanOrEqual(100 - 2 * LABEL.gap);
    const tight = [card(0, -500, 260, 1200), card(280, -500, 220, 1200)];
    const dot = placeLabels(
      [
        {
          id: "d",
          text: "Anything",
          points: [
            { x: 270, y: 0 },
            { x: 270, y: 100 },
          ],
        },
      ],
      { nodes: tight },
    ).get("d")!;
    expect(dot.mode).toBe("dot");
    expect(dot.dot).toBe(1);
  });

  it("never stacks two labels on each other and is deterministic", () => {
    const route = [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
    ];
    const reqs = [
      { id: "a", text: "First label", points: route },
      { id: "b", text: "Second label", points: route },
    ];
    const one = placeLabels(reqs, { nodes: [] });
    const two = placeLabels(reqs, { nodes: [] });
    expect(intersects(boxOf(one.get("a")!), boxOf(one.get("b")!))).toBe(false);
    expect([...one.entries()]).toEqual([...two.entries()]);
  });

  it("pill widths follow the monospace metrics", () => {
    expect(pillWidth(10)).toBe(10 * 6 + 17);
  });
});

describe("path helpers", () => {
  it("rounds corners without overshooting short segments", () => {
    const d = roundedPath(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 6 },
        { x: 200, y: 6 },
      ],
      10,
    );
    expect(d.startsWith("M0,0")).toBe(true);
    expect(d).toContain("Q100,0 100,3");
  });
  it("pointAlong walks the polyline by length", () => {
    expect(
      pointAlong(
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
        ],
        0.75,
      ).point,
    ).toEqual({ x: 100, y: 50 });
  });
});

describe("audit", () => {
  it("reports every kind of overlap", () => {
    const v = auditLayout({
      nodes: [
        { id: "a", rect: card(0, 0) },
        { id: "b", rect: card(100, 20) },
        { id: "c", rect: card(600, 0) },
      ],
      labels: [
        { id: "l1", rect: { x: 590, y: 10, width: 40, height: 18 } },
        { id: "l2", rect: { x: 400, y: 300, width: 40, height: 18 } },
        { id: "l3", rect: { x: 420, y: 305, width: 40, height: 18 } },
      ],
      edges: [
        {
          id: "e1",
          source: "a",
          target: "z",
          points: [
            { x: 330, y: 36 },
            { x: 900, y: 36 },
          ],
        },
        {
          id: "e2",
          source: "q",
          target: "r",
          points: [
            { x: 400, y: 500 },
            { x: 500, y: 500 },
          ],
        },
        {
          id: "e3",
          source: "q",
          target: "r",
          points: [
            { x: 420, y: 501 },
            { x: 520, y: 501 },
          ],
        },
      ],
      groups: [{ id: "g", header: { x: 610, y: 10, width: 60, height: 24 } }],
    });
    const c = countViolations(v);
    expect(c["node-node"]).toBe(1);
    expect(c["label-node"]).toBe(1);
    expect(c["label-label"]).toBe(1);
    expect(c["edge-node"]).toBe(1); // e1 runs through c (not its endpoint)
    expect(c["header-node"]).toBe(1);
    expect(c["label-header"]).toBe(1);
    expect(c["edge-overlap"]).toBe(1);
  });
  it("a clean layout has no violations", () => {
    expect(
      auditLayout({
        nodes: [
          { id: "a", rect: card(0, 0) },
          { id: "b", rect: card(400, 0) },
        ],
        edges: [
          {
            id: "e",
            source: "a",
            target: "b",
            points: [
              { x: 220, y: 36 },
              { x: 400, y: 36 },
            ],
          },
        ],
      }),
    ).toEqual([]);
  });
});

describe("fitAvoiding", () => {
  const pane = { width: 1000, height: 700 };
  const title = { x: 16, y: 16, width: 380, height: 120 };
  it("keeps nodes out from under overlays", () => {
    const items = [card(0, 0), card(800, 400)];
    const v = fitAvoiding(items, pane, [title], { maxZoom: 2 })!;
    const scr = (r: Rect) => ({
      x: r.x * v.zoom + v.x,
      y: r.y * v.zoom + v.y,
      width: r.width * v.zoom,
      height: r.height * v.zoom,
    });
    for (const it of items) expect(intersects(scr(it), title)).toBe(false);
  });
  it("costs no zoom when the overlay's corner is empty anyway", () => {
    // Content shaped like an L with an empty top-left: ignoring the card is fine.
    const items = [card(600, 0), card(0, 400), card(600, 400)];
    const plain = fitAvoiding(items, pane, [], { maxZoom: 2 })!;
    const avoid = fitAvoiding(items, pane, [title], { maxZoom: 2 })!;
    expect(avoid.zoom).toBeCloseTo(plain.zoom, 5);
  });
  it("respects maxZoom and insets", () => {
    const v = fitAvoiding([card(0, 0)], pane, [], { maxZoom: 1.25, insets: { bottom: 100 } })!;
    expect(v.zoom).toBe(1.25);
    expect(v.y + 36 * v.zoom).toBeCloseTo(40 + (700 - 80 - 100) / 2, 0);
  });
});

describe("Router", () => {
  const input = (dx = 0): RouteInput => ({
    nodes: [
      { id: "a", rect: card(0, 0) },
      { id: "b", rect: card(400 + dx, 0) },
      { id: "c", rect: card(400, 300) },
      { id: "x", rect: card(2000, 2000) },
      { id: "y", rect: card(2400, 2000) },
    ],
    edges: [
      { id: "ab", source: "a", target: "b", label: "ab" },
      { id: "ac", source: "a", target: "c", label: "to c" },
      { id: "xy", source: "x", target: "y" },
    ],
  });

  it("routes every edge with labels and keeps pinned sides", () => {
    const r = routeDiagram({
      ...input(),
      edges: [...input().edges, { id: "pin", source: "a", target: "c", sourceSide: "bottom", targetSide: "left" }],
    });
    expect(r.get("ab")!.label?.mode).toBe("full");
    expect(r.get("pin")!.sourceSide).toBe("bottom");
    expect(r.get("pin")!.targetSide).toBe("left");
    expect(r.get("pin")!.points[0].y).toBe(72);
  });

  it("re-runs A* only for edges near what moved, and reuses unchanged results", () => {
    const router = new Router();
    const first = router.route(input());
    expect(router.lastRouted).toBe(3);
    const again = router.route(input());
    expect(router.lastRouted).toBe(0);
    expect(again.get("xy")).toBe(first.get("xy")); // same object: React skips the re-render
    router.route(input(40));
    expect(router.lastRouted).toBeLessThanOrEqual(2);
    expect(router.lastRouted).toBeGreaterThanOrEqual(1);
  });

  it("renaming a boundary searches only nearby routes, including growing and shrinking headers", () => {
    const rect = card(270, -30, 500, 250);
    const base: RouteInput = {
      nodes: [
        { id: "a", rect: card(310, -200) },
        { id: "b", rect: card(310, 200) },
        ...Array.from({ length: 150 }, (_, i) => ({
          id: `far${i}`,
          rect: card(3000 + (i % 10) * 400, 2000 + Math.floor(i / 10) * 200),
        })),
      ],
      edges: [
        { id: "near", source: "a", target: "b" },
        ...Array.from({ length: 135 }, (_, i) => {
          const from = Math.floor(i / 9) * 10 + (i % 9);
          return { id: `distant${i}`, source: `far${from}`, target: `far${from + 1}` };
        }),
      ],
    };
    const router = new Router();
    const named = (label: string): RouteInput => ({
      ...base,
      groups: [{ id: "g", rect, header: groupHeaderRect(rect, label) }],
    });
    const first = router.route(named("Core"));
    expect(router.lastRouted).toBe(136);
    const searches = vi.mocked(routeOrthogonal);
    // One search per keystroke, independent of the 135 unrelated connections. Geometry agrees with
    // a cold router and stays clear of the header as it grows and shrinks (Undo/backspace).
    for (const name of ["Core p", "Core platform", "Core", "C", ""]) {
      searches.mockClear();
      const input = named(name);
      const routes = router.route(input);
      expect(searches).toHaveBeenCalledTimes(1);
      expect(router.lastRouted).toBe(1);
      expect(routes.get("distant0")).toBe(first.get("distant0"));
      const near = routes.get("near")!;
      if (name === "Core platform") expect(near.path).not.toBe(first.get("near")!.path);
      if (name === "Core") expect(near.path).toBe(first.get("near")!.path);
      expect(near).toEqual(routeDiagram(input).get("near"));
      expect(near.ok).toBe(true);
      const header = input.groups![0].header;
      expect(near.points.slice(1).some((p, i) => segmentHitsRect(near.points[i], p, header))).toBe(false);
    }
    router.route(named(""));
    expect(router.lastRouted).toBe(0);
  });

  it("invalidates old and new boundary geometry when boundaries move, resize, appear or disappear", () => {
    const router = new Router();
    const base = input();
    const group = (rect: Rect) => ({ id: "g", rect, header: groupHeaderRect(rect, "Core") });
    router.route(base);
    for (const groups of [
      [group(card(260, -30, 80, 220))],
      [group(card(260, -30, 160, 220))],
      [group(card(1500, -30, 160, 220))],
      [],
      [group(card(260, -30, 80, 220))],
      [],
    ]) {
      const changed = { ...base, groups };
      const routes = router.route(changed);
      expect(router.lastRouted).toBeLessThanOrEqual(2);
      expect(routes).toEqual(routeDiagram(changed));
    }
  });

  it("gives reverse twins their own lanes", () => {
    const r = routeDiagram({
      nodes: [
        { id: "a", rect: card(0, 0) },
        { id: "b", rect: card(400, 0) },
      ],
      edges: [
        { id: "f", source: "a", target: "b" },
        { id: "r", source: "b", target: "a" },
      ],
    });
    expect(r.get("f")!.points[0].y).not.toBe(r.get("r")!.points[0].y);
  });

  it("supports bezier, straight and self-loops", () => {
    const base = input();
    expect(routeDiagram({ ...base, style: "bezier" }).get("ab")!.path).toMatch(/C/);
    expect(routeDiagram({ ...base, style: "straight" }).get("ac")!.points).toHaveLength(2);
    const loop = routeDiagram({
      nodes: [{ id: "a", rect: card(0, 0) }],
      edges: [{ id: "l", source: "a", target: "a" }],
    }).get("l")!;
    expect(loop.points.length).toBeGreaterThan(3);
  });

  it("routes a 150-node grid with one search per connection", () => {
    const grid = (n: number) => {
      const nodes = Array.from({ length: n }, (_, i) => ({
        id: `n${i}`,
        rect: card((i % 10) * 400, Math.floor(i / 10) * 140),
      }));
      const edges = nodes
        .slice(1)
        .map((n, i) => ({ id: `e${i}`, source: nodes[i].id, target: n.id, label: `edge ${i}` }));
      return { nodes, edges };
    };
    // Counted, not timed: one A* search per connection (a second pass, or rerouting the rest after each one, would
    // multiply them). Each search's own cost is guarded in perf.test.ts; a hang still fails at the test's timeout.
    // Routing as a whole isn't linear by design (every search filters the diagram's cards), so no ratio here.
    const { nodes, edges } = grid(150);
    const searches = vi.mocked(routeOrthogonal);
    searches.mockClear();
    const router = new Router();
    const r = router.route({ nodes, edges });
    expect(r.size).toBe(149);
    expect(searches).toHaveBeenCalledTimes(149);
    // The same diagram again: every route is cached, no search runs.
    router.route({ nodes, edges });
    expect(searches).toHaveBeenCalledTimes(149);
    const v = auditLayout({
      nodes,
      edges: edges.map((e) => ({ ...e, points: r.get(e.id)!.points })),
      labels: edges.flatMap((e) => (r.get(e.id)!.label ? [{ id: e.id, rect: boxOf(r.get(e.id)!.label!) }] : [])),
    });
    expect(v.filter((x) => x.kind === "edge-node" || x.kind === "label-node" || x.kind === "label-label")).toEqual([]);
  });
});

describe("hugged spans", () => {
  // The same answer as testing every span (hi > a && lo < b), with a number of reads that grows as the log of the
  // ruler's spans, not with them: a column of aligned nodes puts hundreds on one ruler.
  it("answers as a scan of every span does, reading a logarithmic few", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 1000;
    for (const size of [1, 2, 10, 1_000]) {
      const pairs = Array.from({ length: size }, (): [number, number] => {
        const a = rand();
        return [a, a + rand() / 10];
      });
      const reads = { count: 0 };
      const counted = (xs: number[]) =>
        new Proxy(xs, {
          get(target, key, receiver) {
            if (typeof key === "string" && /^\d+$/.test(key)) reads.count++;
            return Reflect.get(target, key, receiver) as unknown;
          },
        });
      const built = spansOf(pairs);
      const spans = { start: counted(built.start), maxEnd: counted(built.maxEnd) };
      for (let q = 0; q < 200; q++) {
        const lo = rand(),
          hi = lo + rand() / 5;
        reads.count = 0;
        expect(overlapsSpan(spans, lo, hi)).toBe(pairs.some(([a, b]) => hi > a && lo < b));
        expect(reads.count).toBeLessThanOrEqual(2 * Math.ceil(Math.log2(size + 1)) + 2);
      }
    }
  });
});

describe("group borders", () => {
  // A border along the straight way costs three times its length to run on: the route steps off it (12 px or more),
  // on either axis.
  const flip = (p: Point): Point => ({ x: p.y, y: p.x });
  for (const vertical of [false, true]) {
    const t = vertical ? flip : (p: Point) => p;
    const tr = (r: Rect): Rect => (vertical ? { x: r.y, y: r.x, width: r.height, height: r.width } : r);
    it(`keeps a ${vertical ? "vertical" : "horizontal"} route off a boundary's border it would run along`, () => {
      const request = {
        source: t({ x: 0, y: 0 }),
        sourceDir: t({ x: 1, y: 0 }),
        target: t({ x: 1_000, y: 0 }),
        targetDir: t({ x: -1, y: 0 }),
        obstacles: [tr({ x: -40, y: -20, width: 40, height: 40 }), tr({ x: 1_000, y: -20, width: 40, height: 40 })],
      };
      const border: SoftLine = { axis: vertical ? "x" : "y", at: 0, from: -100, to: 1_100 };
      const plain = routeOrthogonal(request);
      const bordered = routeOrthogonal({ ...request, soft: [border] });
      expect(plain.points.map(t)).toEqual([
        { x: 0, y: 0 },
        { x: 1_000, y: 0 },
      ]);
      expect(bordered.points).not.toEqual(plain.points);
      // Off the border between the stubs: every interior point at least 12 px from it.
      const along = bordered.points.slice(2, -2).map(t);
      expect(along.length).toBeGreaterThan(0);
      for (const p of along) expect(Math.abs(p.y)).toBeGreaterThanOrEqual(12);
    });
  }
});

describe("inset outline routing", () => {
  it.each([undefined, "rect"] as const)("preserves rectangular %s routes and their original stubs", (shape) => {
    const source = { ...card(0, 0, 160, 90), shape };
    const target = card(500, 0, 160, 90);
    const obstacle = card(260, 0, 80, 90);
    const expected = routeOrthogonal({
      source: sidePoint(source, "right"),
      sourceDir: { x: 1, y: 0 },
      target: sidePoint(target, "left"),
      targetDir: { x: -1, y: 0 },
      obstacles: [source, target, obstacle],
    });
    const actual = routeDiagram({
      nodes: [
        { id: "s", rect: source },
        { id: "t", rect: target },
        { id: "o", rect: obstacle },
      ],
      edges: [{ id: "e", source: "s", target: "t", sourceSide: "right", targetSide: "left" }],
    }).get("e")!;
    expect(actual.ok).toBe(true);
    expect(actual.points).toEqual(expected.points);
  });
  it.each(["tri", "brace-r"] as const)("escapes %s at either end and avoids the intervening obstacle", (shape) => {
    for (const reverse of [false, true]) {
      const obstacle = card(260, 0, 80, 90);
      const route = routeDiagram({
        nodes: [
          { id: "s", rect: { ...card(0, 0, 160, 90), shape } },
          { id: "obstacle", rect: obstacle },
          { id: "t", rect: card(500, 0, 160, 90) },
        ],
        edges: [
          {
            id: "e",
            source: reverse ? "t" : "s",
            target: reverse ? "s" : "t",
            sourceSide: reverse ? "left" : "right",
            targetSide: reverse ? "right" : "left",
          },
        ],
      }).get("e")!;
      expect(route.ok).toBe(true);
      for (let i = 1; i < route.points.length; i++)
        expect(segmentHitsRect(route.points[i - 1], route.points[i], obstacle)).toBe(false);
    }
  });
});

describe("custom routes", () => {
  it("never searches for custom edges, faces bends, and invalidates custom identity on reset", () => {
    const router = new Router();
    const input: RouteInput = {
      geometry,
      nodes: [
        { id: "a", rect: card(0, 0) },
        { id: "b", rect: card(600, 0) },
      ],
      edges: [
        {
          id: "e",
          source: "a",
          target: "b",
          waypoints: [
            { x: 110, y: 200 },
            { x: 710, y: 200 },
          ],
        },
      ],
    };
    vi.mocked(routeOrthogonal).mockClear();
    for (const style of ["smoothstep", "straight", "bezier"] as const) {
      const r = router.route({ ...input, style }).get("e")!;
      expect(r.custom).toBe(true);
      expect(r.sourceSide).toBe("bottom");
      expect(r.targetSide).toBe("bottom");
      expect(r.points).toContainEqual({ x: 110, y: 200 });
      expect(router.lastRouted).toBe(0);
    }
    expect(routeOrthogonal).not.toHaveBeenCalled();
    const r = router.route({ ...input, edges: [{ id: "e", source: "a", target: "b" }] }).get("e")!;
    expect(r.custom).toBeUndefined();
    expect(router.lastRouted).toBe(1);
  });
  it("does not nudge any segment or swap the neighbours of a fixed edge", () => {
    const p = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ];
    const routes = new Map([
      ["fixed", p],
      ["auto", p.map((p) => ({ ...p }))],
    ]);
    const result = nudgeRoutes(routes, [], { fixed: new Set(["fixed"]) });
    expect(result.get("fixed")).toEqual(p);
    expect(result.get("auto")).not.toEqual(p);
  });
});

it("keeps fixed bends when opposing stubs overlap", () => {
  const fixed = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 200, y: 100 },
  ];
  const auto = [
    { x: 200, y: 0 },
    { x: 50, y: 0 },
    { x: 50, y: -100 },
    { x: 0, y: -100 },
  ];
  expect(
    nudgeRoutes(
      new Map([
        ["fixed", fixed],
        ["auto", auto],
      ]),
      [],
      { fixed: new Set(["fixed"]) },
    ).get("fixed"),
  ).toEqual(fixed);
});
it("reports pending headless saved routes until their geometry is injected", async () => {
  const input: RouteInput = {
    nodes: [
      { id: "a", rect: card(0, 0) },
      { id: "b", rect: card(600, 0) },
    ],
    edges: [{ id: "e", source: "a", target: "b", waypoints: [{ x: 300, y: 500 }] }],
  };
  expect(routeDiagram(input).pending).toEqual(new Set(["e"]));
  const ready = routeDiagram({ ...input, geometry });
  expect(ready.pending.size).toBe(0);
  expect(ready.get("e")?.points).toContainEqual({ x: 110, y: 500 });
  const { whenRouteGeometryReady } = await import("./shapedRuntime");
  expect(routeDiagram(await whenRouteGeometryReady(input))).toEqual(ready);
  expect(routeDiagram(input).pending).toEqual(new Set(["e"]));
});

it("handles a large fixed lane crossed by one automatic route without recursive unions", () => {
  const routes = new Map<string, Point[]>();
  for (let i = 0; i < 1200; i++)
    routes.set(
      `fixed-${i}`,
      Array.from({ length: 64 }, (_, k) => ({
        x: k % 4 < 2 ? 0 : 100,
        y: i * 600 + Math.floor((k + 1) / 2) * 10,
      })),
    );
  const fixed = new Set(routes.keys());
  routes.set("auto", [
    { x: 0, y: -1000 },
    { x: 0, y: 720_000 },
  ]);
  const result = nudgeRoutes(routes, [], { fixed });
  expect(result.size).toBe(routes.size);
  for (const id of fixed) expect(result.get(id)).toEqual(routes.get(id));
});
