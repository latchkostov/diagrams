import { opGrowth } from "../test/opCounter";
import { describe, expect, it, vi } from "vitest";
import { countingReads, GROWTH_FACTOR, LINEAR_LIMIT } from "../test/complexity";
import {
  boundsOf,
  clearOffset,
  COPY_MARGIN,
  findClearTranslation,
  findFree,
  isClear,
  isDownstream,
  placeCopy,
  placeFree,
  placeNextTo,
  placeToward,
  towardOf,
} from "./placement";

const box = (x: number, y: number, width = 220, height = 72) => ({ x, y, width, height });
const overlaps = (c: { x: number; y: number }, b: ReturnType<typeof box>, w = 220, h = 72) =>
  c.x - w / 2 < b.x + b.width && b.x < c.x + w / 2 && c.y - h / 2 < b.y + b.height && b.y < c.y + h / 2;

describe("placeToward (Alt+arrow, the + chip)", () => {
  const size = { width: 220, height: 72 };
  const from = box(1000, 400);
  const at = (c: { x: number; y: number }) => box(c.x - 110, c.y - 36);

  it("goes one gap that way, centred on the node across that axis", () => {
    expect(placeToward(from, size, [from], "right")).toEqual({ x: 1000 + 220 + 80 + 110, y: 436 });
    expect(placeToward(from, size, [from], "left")).toEqual({ x: 1000 - 80 - 110, y: 436 });
    expect(placeToward(from, size, [from], "down")).toEqual({ x: 1110, y: 400 + 72 + 80 + 36 });
    expect(placeToward(from, size, [from], "up")).toEqual({ x: 1110, y: 400 - 80 - 36 });
  });

  it("a fan-out to the right steps down into a column, clear of every sibling", () => {
    const placed = [from];
    for (let i = 0; i < 3; i++) placed.push(at(placeToward(from, size, placed, "right", COPY_MARGIN)));
    const kids = placed.slice(1);
    expect(new Set(kids.map((k) => k.x)).size).toBe(1);
    expect(kids.map((k) => k.y)).toEqual([400, 512, 624]);
    for (const k of kids)
      expect(
        isClear(
          k,
          placed.filter((p) => p !== k),
          COPY_MARGIN,
        ),
      ).toBe(true);
  });

  it("a row below steps right past what's there", () => {
    const blocker = box(1000, 552);
    const c = placeToward(from, size, [from, blocker], "down");
    expect(c.y).toBe(588);
    expect(isClear(at(c), [from, blocker])).toBe(true);
    expect(c.x).toBeGreaterThan(1110);
  });

  it("a wider gap along the flow leaves room for a named edge", () => {
    expect(placeToward(from, size, [from], "right", 0, 160).x).toBe(1000 + 220 + 160 + 110);
    expect(placeToward(from, size, [from], "left", 0, 160).x).toBe(1000 - 160 - 110);
    expect(placeToward(from, size, [from], "down", 0, 160).y).toBe(400 + 72 + 80 + 36);
  });

  it("the margin keeps a spot that only grazes a node from counting as free", () => {
    const grazing = box(1300, 480);
    expect(placeToward(from, size, [from, grazing], "right").y).toBe(436);
    expect(placeToward(from, size, [from, grazing], "right", COPY_MARGIN).y).toBeGreaterThan(436);
  });

  it("→ and ↓ are downstream; ← and ↑ upstream; the flow's direction names its sides", () => {
    expect((["right", "down", "left", "up"] as const).map(isDownstream)).toEqual([true, true, false, false]);
    expect([towardOf("LR"), towardOf("TB"), towardOf("LR", "upstream"), towardOf("TB", "upstream")]).toEqual([
      "right",
      "down",
      "left",
      "up",
    ]);
  });

  it("placeNextTo is the flow-direction case", () => {
    const others = [from, box(1300, 400)];
    expect(placeNextTo(from, size, others, "LR")).toEqual(placeToward(from, size, others, "right"));
    expect(placeNextTo(from, size, others, "TB", "upstream")).toEqual(placeToward(from, size, others, "up"));
  });
});

describe("placeNextTo upstream", () => {
  it("goes one gap to the left (LR), vertically centred on the target", () => {
    const at = placeNextTo(box(0, 120), { width: 220, height: 72 }, [box(0, 120)], "LR", "upstream");
    expect(at.x + 110).toBeLessThan(0);
    expect(at.y).toBe(156);
  });

  it("steps past a node already where the entry point would go", () => {
    const target = box(0, 120);
    const blocker = box(-340, 120);
    const at = placeNextTo(target, { width: 220, height: 72 }, [target, blocker], "LR", "upstream");
    expect(overlaps(at, blocker)).toBe(false);
    expect(overlaps(at, target)).toBe(false);
  });

  it("goes above for top-to-bottom diagrams, stepping right past blockers", () => {
    const target = box(0, 300);
    const above = placeNextTo(target, { width: 220, height: 72 }, [target], "TB", "upstream");
    expect(above.x).toBe(110);
    expect(above.y + 36).toBeLessThan(300);
    const blocker = box(0, 140);
    const moved = placeNextTo(target, { width: 220, height: 72 }, [target, blocker], "TB", "upstream");
    expect(overlaps(moved, blocker)).toBe(false);
  });
});

describe("placeFree", () => {
  const size = { width: 200, height: 120 };
  const clear = (c: { x: number; y: number }, b: ReturnType<typeof box>) =>
    !(c.x - 100 < b.x + b.width && b.x < c.x + 100 && c.y - 60 < b.y + b.height && b.y < c.y + 60);

  it("keeps the centre when it's free", () => {
    expect(placeFree({ x: 0, y: 0 }, size, [box(400, 400)])).toEqual({ x: 0, y: 0 });
  });

  it("moves off a node under the centre, to the nearest clear spot", () => {
    const node = box(-110, -36);
    const at = placeFree({ x: 0, y: 0 }, size, [node]);
    expect(clear(at, node)).toBe(true);
    expect(Math.hypot(at.x, at.y)).toBeLessThan(260);
  });

  it("never stacks a second addition on the first", () => {
    const first = placeFree({ x: 0, y: 0 }, size, []);
    const firstBox = { x: first.x - 100, y: first.y - 60, ...size };
    const second = placeFree({ x: 0, y: 0 }, size, [firstBox]);
    expect(clear(second, firstBox)).toBe(true);
  });

  it("falls back to the centre when there's no room at all", () => {
    const wall = { x: -5000, y: -5000, width: 10000, height: 10000 };
    expect(placeFree({ x: 0, y: 0 }, size, [wall], { maxRings: 3 })).toEqual({ x: 0, y: 0 });
  });
});

describe("copies never land on anything (Ctrl+D, Ctrl+V, Alt-drag)", () => {
  const moved = (b: ReturnType<typeof box>, d: { x: number; y: number }) => ({ ...b, x: b.x + d.x, y: b.y + d.y });

  it("boundsOf and isClear", () => {
    expect(boundsOf([box(0, 0, 10, 10), box(20, 30, 10, 10)])).toEqual({ x: 0, y: 0, width: 30, height: 40 });
    expect(boundsOf([])).toBeNull();
    expect(isClear(box(0, 0, 10, 10), [box(20, 0, 10, 10)])).toBe(true);
    expect(isClear(box(0, 0, 10, 10), [box(20, 0, 10, 10)], 16)).toBe(false);
  });

  it("Ctrl+D: one gap beside the original in the flow direction", () => {
    const original = box(0, 0);
    const d = placeCopy(original, [original]);
    expect(d.y).toBe(0);
    expect(d.x).toBeGreaterThan(original.width);
    expect(placeCopy(original, [original], "TB").x).toBe(0);
    expect(placeCopy(original, [original], "TB").y).toBeGreaterThan(original.height);
  });

  it("Ctrl+D: steps across the flow past the next node, and clear of it by a margin", () => {
    const original = box(0, 0);
    const next = box(300, 0);
    const below = box(300, 100);
    const others = [original, next, below];
    const copy = moved(original, placeCopy(original, others));
    for (const o of others) expect(isClear(copy, [o], COPY_MARGIN - 1)).toBe(true);
  });

  it("Ctrl+V / Alt-drop: a clear spot stays, a taken one moves to the nearest free place", () => {
    const there = box(0, 0);
    expect(clearOffset(box(600, 600), [there])).toEqual({ x: 0, y: 0 });
    const onTop = box(10, 10);
    const d = clearOffset(onTop, [there]);
    expect(isClear(moved(onTop, d), [there], COPY_MARGIN - 1)).toBe(true);
    expect(Math.hypot(d.x, d.y)).toBeLessThan(200);
  });

  it("a second paste at the same spot steps clear of the first", () => {
    const first = box(0, 0);
    const second = moved(first, clearOffset(first, [first]));
    expect(isClear(second, [first])).toBe(true);
  });
});

describe("a failed search is never a silent overlap", () => {
  it("findFree says null when nothing within reach is free", () => {
    const wall = { x: -5000, y: -5000, width: 10000, height: 10000 };
    expect(findFree({ x: 0, y: 0 }, { width: 10, height: 10 }, [wall], { maxRings: 3 })).toBeNull();
  });

  it("a 2000×2000 paste over four originals at its corners lands past them, not on them", () => {
    const big = { x: 0, y: 0, width: 2000, height: 2000 };
    const corners = [box(0, 0, 200, 200), box(1800, 0, 200, 200), box(0, 1800, 200, 200), box(1800, 1800, 200, 200)];
    const d = clearOffset(big, corners);
    expect(isClear({ ...big, x: big.x + d.x, y: big.y + d.y }, corners)).toBe(true);
  });

  it("a Ctrl+D copy with no side free and no room nearby still lands clear", () => {
    const original = box(0, 0, 200, 100);
    const crowd = [original];
    for (let i = -12; i <= 12; i++)
      for (let j = -12; j <= 12; j++) if (i || j) crowd.push(box(i * 230, j * 130, 200, 100));
    const d = placeCopy(original, crowd);
    expect(isClear({ ...original, x: d.x, y: d.y }, crowd)).toBe(true);
  });
});

describe("findClearTranslation (the one free-place search)", () => {
  it("stops large-candidate scans at the obstacle-test budget", () => {
    const candidate = box(0, 0, 1_000_000, 1_000_000);
    const obstacles = [box(-300, 0), box(1_000_100, 0)];
    const accept = vi.fn(() => true);
    const options = { margin: 0, accept, budget: { tests: 1, accepts: 1 } };
    expect(findClearTranslation([candidate], obstacles, options)).toBeNull();
    expect(accept).not.toHaveBeenCalled();
    expect(findClearTranslation([candidate], obstacles, { ...options, budget: { tests: 2, accepts: 1 } })).toEqual({
      x: 0,
      y: 0,
    });
    expect(accept).toHaveBeenCalledExactlyOnceWith({ x: 0, y: 0 });
  });
  it("bounds cell visits for huge candidates independently of their area", () => {
    for (const extent of [300_000, 1_000_000]) {
      let visits = 0;
      const get = Map.prototype.get;
      const spy = vi.spyOn(Map.prototype, "get").mockImplementation(function (
        this: Map<unknown, unknown>,
        key: unknown,
      ) {
        if (++visits > 64) throw new Error("Unbounded candidate cell scan");
        return get.call(this, key);
      });
      let result;
      let exhausted;
      try {
        // A reachable obstacle just outside the candidate: the original grid query walks
        // its entire empty area before it can accept the unchanged position.
        result = findClearTranslation([box(0, 0, extent, extent)], [box(extent + 100, 0)], { margin: 0 });
        // Every candidate hits the central obstacle: exhaust all rings, then use
        // the caller's deterministic, nonoverlapping fallback.
        const blocked = box(0, 0, extent, extent);
        const obstacles = [box(extent / 2, extent / 2)];
        exhausted = findFree({ x: extent / 2, y: extent / 2 }, blocked, obstacles);
        const offset = clearOffset(blocked, [blocked]);
        if (!isClear({ ...blocked, x: offset.x, y: offset.y }, [blocked]))
          throw new Error("Fallback overlaps its obstacle");
      } finally {
        spy.mockRestore();
      }
      expect(result).toEqual({ x: 0, y: 0 });
      expect(exhausted).toBeNull();
      expect(visits).toBeLessThanOrEqual(64);
    }
  });
  it("moves a group of boxes together, nearest first, clear of everything by the margin", () => {
    const boxes = [box(0, 0), box(300, 0)];
    const d = findClearTranslation(boxes, [box(300, 0)], { margin: COPY_MARGIN });
    expect(d).not.toBeNull();
    for (const b of boxes)
      expect(isClear({ ...b, x: b.x + d!.x, y: b.y + d!.y }, [box(300, 0)], COPY_MARGIN)).toBe(true);
  });

  it("says null when the search runs out, never an overlapping move", () => {
    expect(findClearTranslation([box(0, 0)], [box(-5000, -5000, 10000, 10000)], { maxRings: 40 })).toBeNull();
  });

  it("stops at its budget instead of blocking the page", () => {
    // Every box clashes with a field of small obstacles: the work, not the search's reach, ends it.
    const boxes = Array.from({ length: 300 }, (_, i) => box((i % 30) * 240, Math.floor(i / 30) * 90));
    const field = Array.from({ length: 3000 }, (_, i) =>
      box((i % 60) * 120 - 200, Math.floor(i / 60) * 30 - 200, 100, 20),
    );
    const budget = { tests: 50_000, accepts: 10 };
    const search = (maxRings: number) => () => findClearTranslation(boxes, field, { budget, maxRings });
    expect(search(40)()).toBeNull();
    // Measured against a one-ring search of the same field (indexing it, then eight spots): the budgeted 40-ring
    // search costs a few times that, an unbounded one (every ring, every box) over a hundred. A comparison in the
    // same run, not a budget in ms, so a busy machine doesn't fail it.
    expect(opGrowth(search(1), search(40))).toBeLessThan(LINEAR_LIMIT);
  });

  it("indexes obstacles once: hundreds of boxes against thousands of far obstacles stay fast", () => {
    // Count reads of both boxes and obstacles: once per search grows 8x with the scene;
    // scanning or indexing all obstacles per box grows 64x, without a timing measurement.
    const scene = (n: number) => {
      const boxes = countingReads(Array.from({ length: n }, (_, i) => box((i % 20) * 300, Math.floor(i / 20) * 200)));
      const far = Array.from({ length: n * 25 }, (_, i) => box(50_000 + (i % 100) * 300, (i / 100) * 200));
      const blocker = box(-100, -100, 7000, 400);
      const obstacles = countingReads([...far, blocker]);
      expect(findClearTranslation(boxes.items, obstacles.items)).not.toBeNull();
      // The reach filter scans the input once; placements then query only the nearby index.
      expect(obstacles.reads()).toBe(far.length + 1);
      return boxes.reads() + obstacles.reads();
    };
    const small = scene(25);
    expect(small).toBeGreaterThan(0);
    expect(scene(25 * GROWTH_FACTOR) / small).toBeLessThan(LINEAR_LIMIT);
  });
});
