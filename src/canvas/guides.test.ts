import { describe, expect, it } from "vitest";
import { guideIndex, nudgeOnGrid, snapMove, type Box, type SnapOptions } from "./guides";

const card = (x: number, y: number, width = 120, height = 40): Box => ({ x, y, width, height });
const opts: SnapOptions = { threshold: 6, reach: 600, guides: true, grid: 10 };

describe("snapMove: alignment", () => {
  const others = [card(100, 100), card(400, 300)];
  const index = guideIndex(others);

  it("snaps a near edge to another node's, and draws one line across both (the centre for equal sizes)", () => {
    const r = snapMove(index, card(104, 220), opts);
    expect(r.dx).toBe(-4);
    expect(r.lines).toEqual([{ axis: "x", at: 160, from: 100, to: 260 }]);
    // A narrower card shares only its left edge: that's the line.
    const narrow = snapMove(index, card(103, 220, 80), opts);
    expect(narrow.dx).toBe(-3);
    expect(narrow.lines).toEqual([{ axis: "x", at: 100, from: 100, to: 260 }]);
  });

  it("snaps centres and right edges too", () => {
    // Each edge and the centre are 5 px off the other card's, within 6.
    expect(snapMove(index, card(105, 200, 120), opts).dx).toBe(-5);
    // Right edge 523 vs 520.
    expect(snapMove(index, card(403, 200), opts).dx).toBe(-3);
    // Vertical centres: 300..340 has its centre at 320; a box at y 297 is 3 px above.
    expect(snapMove(index, card(700, 297), opts).dy).toBe(3);
  });

  it("snaps when only centres are within threshold", () => {
    // A 60 px card against a 120 px one: its edges are about 30 px off theirs, its centre 1 px (the grid
    // would move it 4 px instead).
    const one = guideIndex([card(103, 100, 120)]);
    const r = snapMove(one, card(134, 300, 60), opts);
    expect(r.dx).toBe(-1);
    expect(r.lines).toEqual([{ axis: "x", at: 163, from: 100, to: 340 }]);
  });

  it("snaps when only trailing edges are within threshold", () => {
    // Right edges 224 and 223 (its left edge is 19 px off, its centre 21); the grid would move it 4 px.
    const x = snapMove(guideIndex([card(103, 100, 120, 40)]), card(144, 300, 80), opts);
    expect(x.dx).toBe(-1);
    expect(x.lines).toEqual([{ axis: "x", at: 223, from: 100, to: 340 }]);
    // Bottom edges 142 and 144, on a 10 px tall card (its top is 8 px off, its middle 7); the grid: -2.
    const y = snapMove(guideIndex([card(100, 104, 120, 40)]), card(500, 132, 120, 10), opts);
    expect(y.dy).toBe(2);
    expect(y.lines).toEqual([{ axis: "y", at: 144, from: 100, to: 620 }]);
  });

  it("falls back to the grid when nothing is near, and rounds each axis on its own", () => {
    const r = snapMove(index, card(733, 556), opts);
    expect([r.dx, r.dy]).toEqual([-3, 4]);
    expect(r.lines).toEqual([]);
  });

  it("aligns to an off-grid node exactly (guides beat the grid)", () => {
    const off = guideIndex([card(423, 100)]);
    expect(snapMove(off, card(419, 300), opts).dx).toBe(4);
  });

  it("ignores lines farther than the threshold, and boxes farther than the reach", () => {
    expect(snapMove(index, card(110, 220), opts).lines).toEqual([]);
    const far = snapMove(index, card(104, 1200), { ...opts, reach: 600 });
    expect(far.lines).toEqual([]);
    expect(far.dx).toBe(-4); // the grid, not the guide
  });

  it("only snaps to the grid while guides are off (a fast drag)", () => {
    const r = snapMove(index, card(104, 223), { ...opts, guides: false });
    expect([r.dx, r.dy]).toEqual([-4, -3]);
    expect(r.lines).toEqual([]);
  });

  it("does nothing at all with no guides and no grid (Ctrl held)", () => {
    const r = snapMove(index, card(104, 223), { ...opts, guides: false, grid: 0 });
    expect([r.dx, r.dy]).toEqual([0, 0]);
  });
});

describe("snapMove: equal spacing", () => {
  it("centres a box between its two row neighbours", () => {
    // Gap between A (ends 220) and B (starts 500) is 280; a 120 px card fits with 80 each side: x = 300.
    const index = guideIndex([card(100, 100), card(500, 100)]);
    const r = snapMove(index, card(304, 110), opts);
    expect(r.dx).toBe(-4);
    expect(r.gaps).toEqual([
      { axis: "x", from: 220, to: 300, at: 125 },
      { axis: "x", from: 420, to: 500, at: 125 },
    ]);
  });

  it("repeats the gap of a row: one gap past the last node", () => {
    // A 100..220, B 300..420: gap 80. The next card goes at 500.
    const index = guideIndex([card(100, 100), card(300, 100)]);
    const r = snapMove(index, card(497, 105), opts);
    expect(r.dx).toBe(3);
    expect(r.gaps.map((g) => [g.from, g.to])).toEqual([
      [220, 300],
      [420, 500],
    ]);
  });

  it("repeats the gap before the first node", () => {
    const row = guideIndex([card(300, 100), card(500, 100)]);
    // Gap 80; before 300 a card ends at 220, so it starts at 100.
    expect(snapMove(row, card(103, 100), opts).dx).toBe(-3);
  });

  it("repeats a column gap without an alignment guide", () => {
    // Off the grid, so the spacing (306) and the grid (300) disagree: gap 63 (140..203), next card at 306.
    const column = guideIndex([card(103, 100), card(103, 203)]);
    const r = snapMove(column, card(147, 302), opts);
    expect(r.dy).toBe(4);
    expect(r.lines).toEqual([]);
    expect(r.gaps.filter((g) => g.axis === "y").map((g) => [g.from, g.to])).toEqual([
      [140, 203],
      [243, 306],
    ]);
    expect(r.gaps).toHaveLength(2);
  });

  it("shows the line and the gaps when an alignment and an equal gap agree", () => {
    // A column of equal gaps (60), and a node to the side whose top is where the next one goes.
    const index = guideIndex([card(100, 100), card(100, 200), card(500, 300)]);
    const r = snapMove(index, card(100, 303), opts);
    expect(r.dy).toBe(-3);
    expect(r.lines.some((l) => l.axis === "y")).toBe(true);
    expect(r.gaps.filter((g) => g.axis === "y")).toHaveLength(2);
  });

  it("ignores nodes outside the row", () => {
    const index = guideIndex([card(100, 100), card(300, 400)]);
    expect(snapMove(index, card(503, 100), opts).gaps).toEqual([]);
  });
});

describe("guideIndex", () => {
  it("indexes 150 nodes and snaps each move in well under a millisecond", () => {
    const boxes = Array.from({ length: 150 }, (_, i) =>
      card((i % 15) * 360 + 40, Math.floor(i / 15) * 120 + 40, 127, 35),
    );
    const t0 = performance.now();
    const index = guideIndex(boxes);
    const built = performance.now() - t0;
    const t1 = performance.now();
    for (let i = 0; i < 200; i++) snapMove(index, card(1000 + i * 3, 500 + i, 127, 35), { ...opts, reach: 2000 });
    const perMove = (performance.now() - t1) / 200;
    expect(built).toBeLessThan(50);
    expect(perMove).toBeLessThan(1);
  });
});

describe("nudgeOnGrid", () => {
  it("moves to the next grid line in the direction pressed", () => {
    expect(nudgeOnGrid(423, 1, 10, null)).toBe(7);
    expect(nudgeOnGrid(423, -1, 10, null)).toBe(-3);
    expect(nudgeOnGrid(420, 1, 10, null)).toBe(10);
    expect(nudgeOnGrid(420, -1, 10, null)).toBe(-10);
    expect(nudgeOnGrid(-15, 1, 10, null)).toBe(5);
    expect(nudgeOnGrid(420, 0, 10, null)).toBe(0);
  });

  it("Shift moves the far step, landing on the grid", () => {
    expect(nudgeOnGrid(420, 1, 10, 50)).toBe(50);
    expect(nudgeOnGrid(423, 1, 10, 50)).toBe(47);
    expect(nudgeOnGrid(423, -1, 10, 50)).toBe(-53);
  });
});
