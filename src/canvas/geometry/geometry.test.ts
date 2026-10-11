import { describe, expect, it } from "vitest";
import { auditLayout, countViolations } from "./audit";
import { fitAvoiding } from "./fit";
import { LABEL, pillWidth, placeLabels, wrapLines } from "./labels";
import { nudgeRoutes } from "./nudge";
import { pointAlong, roundedPath } from "./path";
import { slotOffset, spreadPorts } from "./ports";
import { intersects, segmentHitsRect, simplify, type Point, type Rect } from "./rect";
import { Router, routeDiagram, type RouteInput } from "./router";

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
    expect(p.get("up")!.y).toBeLessThan(p.get("mid")!.y);
    expect(p.get("mid")!.y).toBeLessThan(p.get("down")!.y);
    expect(p.get("mid")).toEqual({ x: 220, y: 136 });
    expect(p.get("down")!.y - p.get("mid")!.y).toBe(14);
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

  it("routes a 150-node grid quickly", () => {
    const nodes = Array.from({ length: 150 }, (_, i) => ({
      id: `n${i}`,
      rect: card((i % 10) * 400, Math.floor(i / 10) * 140),
    }));
    const edges = nodes
      .slice(1)
      .map((n, i) => ({ id: `e${i}`, source: nodes[i].id, target: n.id, label: `edge ${i}` }));
    const t0 = performance.now();
    const r = routeDiagram({ nodes, edges });
    const ms = performance.now() - t0;
    expect(r.size).toBe(149);
    expect(ms).toBeLessThan(1500);
    const v = auditLayout({
      nodes,
      edges: edges.map((e) => ({ ...e, points: r.get(e.id)!.points })),
      labels: edges.flatMap((e) => (r.get(e.id)!.label ? [{ id: e.id, rect: boxOf(r.get(e.id)!.label!) }] : [])),
    });
    expect(v.filter((x) => x.kind === "edge-node" || x.kind === "label-node" || x.kind === "label-label")).toEqual([]);
  });
});
