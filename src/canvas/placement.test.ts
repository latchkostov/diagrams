import { describe, expect, it } from "vitest";
import { placeFree, placeNextTo } from "./placement";

const box = (x: number, y: number, width = 220, height = 72) => ({ x, y, width, height });
const overlaps = (c: { x: number; y: number }, b: ReturnType<typeof box>, w = 220, h = 72) =>
  c.x - w / 2 < b.x + b.width && b.x < c.x + w / 2 && c.y - h / 2 < b.y + b.height && b.y < c.y + h / 2;

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
