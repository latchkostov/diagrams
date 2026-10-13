import { describe, expect, it } from "vitest";
import { fitAxis, scaleAcross, tidyLayout, TIDY_GAP, type TidyBox } from "./tidy";
import { spreadOverlaps } from "./arrange";
import { growth, GROWTH_FACTOR, LINEAR_LIMIT, QUADRATIC_LIMIT } from "../test/complexity";

const card = (id: string, x: number, y: number, label?: string): TidyBox => ({
  id,
  x,
  y,
  width: 220,
  height: 72,
  label,
});
type Rect = { x: number; y: number; width: number; height: number };
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const placed = (boxes: readonly TidyBox[], pos: Map<string, { x: number; y: number }> | null) => {
  if (!pos) throw new Error("Expected a tidy layout");
  return boxes.map((b) => ({ ...b, ...pos.get(b.id)! }));
};
const noOverlaps = (boxes: readonly Rect[]) => {
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) if (overlaps(boxes[i], boxes[j])) return false;
  return true;
};

// A messy chain a → b → c with a branch b → d, scattered over a 900 × 500 box at (1000, 400).
const messy = [card("a", 1000, 700), card("b", 1500, 400), card("c", 1100, 820), card("d", 1680, 760)];
const chain = [
  { from: "a", to: "b" },
  { from: "b", to: "c" },
  { from: "b", to: "d" },
];

describe("tidyLayout", () => {
  it("lays the selection out in layers by its edges, keeping its top-left", () => {
    const pos = tidyLayout({ nodes: messy, edges: chain });
    const out = placed(messy, pos);
    // a → b → (c, d): three columns left to right.
    expect(out[0].x).toBeLessThan(out[1].x);
    expect(out[1].x).toBeLessThan(out[2].x);
    expect(out[2].x).toBe(out[3].x);
    // The top-left of the selection's box stays.
    expect(Math.min(...out.map((b) => b.x))).toBe(1000);
    expect(Math.min(...out.map((b) => b.y))).toBe(400);
    expect(noOverlaps(out)).toBe(true);
  });

  it("fits inside the selection's box when the minimum gaps allow", () => {
    const pos = tidyLayout({ nodes: messy, edges: chain });
    const out = placed(messy, pos);
    const right = Math.max(...out.map((b) => b.x + b.width));
    // The box was 900 wide (1000 to 1900): three 220 columns and two gaps of at least 80 fit.
    expect(right).toBeLessThanOrEqual(1900);
    expect(out[1].x - (out[0].x + 220)).toBeGreaterThanOrEqual(TIDY_GAP.along);
  });

  it("keeps room for a named edge's label between its columns", () => {
    const named = [{ from: "a", to: "b", label: "Authorize payment" }, ...chain.slice(1)];
    const out = placed(messy, tidyLayout({ nodes: messy, edges: named }));
    const plain = placed(messy, tidyLayout({ nodes: messy, edges: chain }));
    // The named gap isn't closed up; the plain one is.
    expect(out[1].x - (out[0].x + 220)).toBeGreaterThan(plain[1].x - (plain[0].x + 220));
    expect(out[1].x - (out[0].x + 220)).toBeGreaterThan(TIDY_GAP.along);
  });

  it("follows a top-to-bottom diagram", () => {
    const pos = tidyLayout({ nodes: messy, edges: chain, direction: "TB" });
    const out = placed(messy, pos);
    expect(out[0].y).toBeLessThan(out[1].y);
    expect(out[1].y).toBeLessThan(out[2].y);
    expect(out[2].y).toBe(out[3].y);
  });

  it("never lands on anything else: the tidied nodes move together to the nearest free place", () => {
    // A node that isn't selected sits where the tidied layout would put c.
    const blocker = { x: 1500, y: 400, width: 220, height: 72 };
    const pos = tidyLayout({ nodes: messy, edges: chain, others: [blocker] });
    const out = placed(messy, pos);
    for (const b of out) expect(overlaps(b, blocker)).toBe(false);
    expect(noOverlaps(out)).toBe(true);
  });

  it("does nothing with fewer than two nodes", () => {
    expect(tidyLayout({ nodes: [card("a", 0, 0)], edges: [] })?.size).toBe(0);
  });

  it("when no place within reach is clear, gives up instead of landing on something", () => {
    // Three clear cards around a huge shape the tidied row would land on, with no free place within reach.
    const nodes = [card("a", 0, 4000), card("b", 4000, 0), card("c", 4000, 4000)];
    const shape = { x: -1000, y: -1000, width: 4000, height: 4000 };
    expect(nodes.every((n) => !overlaps(n, shape))).toBe(true);
    const r = tidyLayout({
      nodes,
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
      others: [shape],
    });
    expect(r).toBeNull();
    // Ten stacked cards beside a tall shape: the row would cross it everywhere within reach.
    const column = Array.from({ length: 10 }, (_, i) => card(`n${i}`, 0, i * 100));
    const tall = { x: 250, y: -1000, width: 3000, height: 5000 };
    const chain10 = column.slice(1).map((n, i) => ({ from: column[i].id, to: n.id }));
    const res = tidyLayout({ nodes: column, edges: chain10, others: [tall] });
    if (res) for (const b of placed(column, res)) expect(overlaps(b, tall)).toBe(false);
  });

  it("asks `accept` about each place, and gives up when it refuses them all", () => {
    let asked = 0;
    const none = tidyLayout({
      nodes: messy,
      edges: chain,
      accept: () => {
        asked++;
        return false;
      },
    });
    expect(none).toBeNull();
    // Bounded: it stops asking once the budget is spent.
    expect(asked).toBeLessThanOrEqual(200);
    // A place the caller accepts is taken: here, only ones moved down.
    const down = tidyLayout({ nodes: messy, edges: chain, accept: (p) => (p.get("a")?.y ?? 0) > 400 });
    expect(placed(messy, down)[0].y).toBeGreaterThan(400);
  });

  it("stays fast on a large selection among many obstacles, even when it can't find room", () => {
    // `n` selected nodes in a chain, 3n others, and a note covering where the tidied layout would go.
    const scene = (n: number) => {
      const nodes = Array.from({ length: n }, (_, i) => card(`s${i}`, (i % 20) * 300, Math.floor(i / 20) * 200));
      const edges = nodes.slice(1).map((m, i) => ({ from: nodes[i].id, to: m.id }));
      const others = [
        ...Array.from({ length: n * 3 }, (_, i) => ({
          x: 20000 + (i % 30) * 300,
          y: (i / 30) * 200,
          width: 220,
          height: 72,
        })),
        { x: -500, y: -500, width: 80000, height: 3000 },
      ];
      return { nodes, edges, others };
    };
    const { nodes, edges, others } = scene(200);
    const r = tidyLayout({ nodes, edges, others });
    if (r) expect(placed(nodes, r).some((b) => others.some((o) => overlaps(b, o)))).toBe(false);
    // Measured against the same tidy with nothing in the way (the layout alone): failing to find room costs a few
    // times that, since the search stops at the first box that clashes and at its budget. Testing every box at
    // every one of the 6,560 spots costs hundreds of times more. A comparison in the same run, not a budget in ms.
    expect(
      growth(
        () => tidyLayout({ nodes, edges }),
        () => tidyLayout({ nodes, edges, others }),
        { samples: 3 },
      ),
    ).toBeLessThan(LINEAR_LIMIT);
    // And eight times the selection and the obstacles: about 8 times the work at most.
    const small = scene(25);
    const large = scene(25 * GROWTH_FACTOR);
    expect(
      growth(
        () => tidyLayout(small),
        () => tidyLayout(large),
        { samples: 3 },
      ),
    ).toBeLessThan(LINEAR_LIMIT);
  });
});

describe("fitting the layers into a box", () => {
  it("closes the gaps between layers evenly, never below the minimum", () => {
    const boxes = [card("a", 0, 0), card("b", 400, 0), card("c", 800, 0)];
    const at = fitAxis(boxes, "x", 820, () => 80);
    // Span 1020 → 820: each 180 px gap gives up 100.
    expect([at.get("a"), at.get("b"), at.get("c")]).toEqual([0, 300, 600]);
    const floor = fitAxis(boxes, "x", 100, () => 80);
    expect(floor.get("b")! - 220).toBe(80);
  });

  it("draws a layer's slots together across the flow, not closer than the gap", () => {
    const boxes = [card("a", 0, 0), card("b", 0, 300), card("c", 400, 150)];
    const at = scaleAcross(boxes, "y", 300, "x", 40);
    expect(at.get("b")! - at.get("a")!).toBeGreaterThanOrEqual(72 + 40);
    expect(at.get("a")).toBe(0);
  });
});

describe("align and distribute never stack nodes", () => {
  it("lining up a column's tops spreads them along the row", () => {
    const column = [
      { id: "a", x: 0, y: 0, width: 220, height: 72 },
      { id: "b", x: 0, y: 120, width: 220, height: 72 },
      { id: "c", x: 0, y: 240, width: 220, height: 72 },
    ];
    const aligned = new Map(column.map((b) => [b.id, { x: b.x, y: 0 }]));
    const out = spreadOverlaps(column, aligned, "h");
    const boxes = column.map((b) => ({ ...b, ...out.get(b.id)! }));
    expect(boxes.every((b) => b.y === 0)).toBe(true);
    expect(noOverlaps(boxes)).toBe(true);
    expect(out.get("b")!.x).toBe(260);
  });

  it("a thousand boxes aligned onto one spot spread in one pass", () => {
    const line = (n: number) => {
      const row = Array.from({ length: n }, (_, i) => ({ id: `b${i}`, x: i * 300, y: 0, width: 220, height: 72 }));
      return { row, aligned: new Map(row.map((b) => [b.id, { x: 0, y: 0 }])) };
    };
    // One pass, each box against the ones before it: quadratic by design, 64 times the work for 8 times the boxes.
    // Spreading again until nothing overlaps would be cubic, 512. A ratio, not a budget in ms.
    const small = line(125);
    const large = line(125 * GROWTH_FACTOR);
    expect(
      growth(
        () => spreadOverlaps(small.row, small.aligned, "h"),
        () => spreadOverlaps(large.row, large.aligned, "h"),
      ),
    ).toBeLessThan(QUADRATIC_LIMIT);
    const { row, aligned } = large;
    const out = spreadOverlaps(row, aligned, "h");
    const xs = row.map((b) => out.get(b.id)!.x);
    // In their order, each one gap past the one before.
    expect(xs.slice(0, 3)).toEqual([0, 260, 520]);
    expect(xs.every((x, i) => i === 0 || x === xs[i - 1] + 260)).toBe(true);
  });

  it("leaves boxes that don't overlap where they are", () => {
    const row = [
      { id: "a", x: 0, y: 0, width: 220, height: 72 },
      { id: "b", x: 300, y: 30, width: 220, height: 72 },
    ];
    const aligned = new Map(row.map((b) => [b.id, { x: b.x, y: 0 }]));
    expect(spreadOverlaps(row, aligned, "h")).toEqual(aligned);
  });
});
