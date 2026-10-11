import { describe, expect, it } from "vitest";
import { placeNextTo } from "./placement";

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
