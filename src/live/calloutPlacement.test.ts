import { describe, expect, it } from "vitest";
import { calloutOffset } from "./calloutPlacement";
import { inflate, intersects, type Rect } from "../canvas/geometry/rect";

describe("floating callout room", () => {
  const pane = { width: 856, height: 408 };
  const chrome: Rect[] = [
    { x: 16, y: 16, width: 220, height: 70 },
    { x: 748, y: 16, width: 90, height: 36 },
    { x: 16, y: 114, width: 32, height: 176 },
    { x: 16, y: 340, width: 824, height: 48 },
  ];
  const nodes: Rect[] = [
    { x: 160, y: 104, width: 68, height: 22 },
    { x: 260, y: 64, width: 68, height: 22 },
    ...Array.from({ length: 24 }, (_, i) => ({
      x: 346 + (i % 4) * 96,
      y: 64 + Math.floor(i / 4) * 42,
      width: 68,
      height: 22,
    })),
  ];
  const clear = (desired: Rect, obstacles: Rect[]) => {
    const offset = calloutOffset(
      desired,
      pane,
      obstacles.map((o) => inflate(o, 8)),
    );
    expect(offset).not.toBeNull();
    const placed = { ...desired, x: desired.x + offset!.dx, y: desired.y + offset!.dy };
    expect(placed.x).toBeGreaterThanOrEqual(0);
    expect(placed.y).toBeGreaterThanOrEqual(0);
    expect(placed.x + placed.width).toBeLessThanOrEqual(pane.width);
    expect(placed.y + placed.height).toBeLessThanOrEqual(pane.height);
    expect(obstacles.some((o) => intersects(placed, inflate(o, 20)))).toBe(false);
    return placed;
  };

  it("keeps the compact headline and action clear when a taller text layout cannot fit", () => {
    const obstacles = [...chrome, ...nodes];
    expect(
      calloutOffset(
        { x: 252, y: 60, width: 482, height: 74 },
        pane,
        obstacles.map((o) => inflate(o, 8)),
      ),
    ).toBeNull();
    clear({ x: 252, y: 60, width: 340, height: 42 }, obstacles);
  });

  it("finds a diagonal free position after nodes are panned into the compact callout", () => {
    const shifted = nodes.map((n) => ({ ...n, x: n.x + 132, y: n.y - 54 }));
    const offset = clear({ x: 252, y: 60, width: 340, height: 42 }, [...chrome, ...shifted]);
    expect(offset.x).not.toBe(252);
    expect(offset.y).not.toBe(60);
  });

  it("accepts the non-enumerable dimensions of a DOMRect", () => {
    const domPane = Object.defineProperties(
      {},
      {
        width: { value: pane.width },
        height: { value: pane.height },
      },
    ) as typeof pane;
    const desired = { x: 252, y: 60, width: 340, height: 42 };
    const obstacles = [...chrome, ...nodes].map((o) => inflate(o, 8));
    expect(calloutOffset(desired, domPane, obstacles)).toEqual(calloutOffset(desired, pane, obstacles));
    expect(calloutOffset(desired, domPane, obstacles)).not.toEqual({ dx: 0, dy: 0 });
  });
});
