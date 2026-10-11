import { describe, expect, it } from "vitest";
import { facingSide, laneOffset, pickSides, type Rect } from "./routing";

const card = (x: number, y: number): Rect => ({ x, y, width: 220, height: 72 });
// Example grid: x = 40 + col * 360, y = 40 + row * 120.
const at = (col: number, row: number) => card(40 + col * 360, 40 + row * 120);

describe("pickSides", () => {
  it("forward neighbours flow right → left", () => {
    expect(pickSides(at(0, 0), at(1, 0))).toEqual({ sourceSide: "right", targetSide: "left" });
    // Fan-out to nearby rows stays horizontal in an LR diagram.
    expect(pickSides(at(0, 2), at(1, 0))).toEqual({ sourceSide: "right", targetSide: "left" });
  });

  it("back-edges leave from the left instead of looping around", () => {
    expect(pickSides(at(3, 1), at(2, 1))).toEqual({ sourceSide: "left", targetSide: "right" });
  });

  it("stacked nodes connect bottom → top (or top → bottom when going up)", () => {
    expect(pickSides(at(1, 0), at(1, 2))).toEqual({ sourceSide: "bottom", targetSide: "top" });
    expect(pickSides(at(1, 3), at(1, 1))).toEqual({ sourceSide: "top", targetSide: "bottom" });
  });

  it("switches to vertical when far more apart vertically than horizontally", () => {
    expect(pickSides(card(0, 0), card(260, 600))).toEqual({ sourceSide: "bottom", targetSide: "top" });
  });

  it("TB diagrams prefer the vertical axis", () => {
    expect(pickSides(card(0, 0), card(300, 160), { direction: "TB" })).toEqual({ sourceSide: "bottom", targetSide: "top" });
    expect(pickSides(card(0, 0), card(300, 160), { direction: "LR" })).toEqual({ sourceSide: "right", targetSide: "left" });
  });

  it("overlapping boxes use the dominant centre offset", () => {
    expect(pickSides(card(0, 0), card(150, 10))).toEqual({ sourceSide: "right", targetSide: "left" });
    expect(pickSides(card(0, 0), card(10, 50))).toEqual({ sourceSide: "bottom", targetSide: "top" });
  });

  it("keeps pinned sides and points the free end at the pinned one", () => {
    expect(pickSides(at(0, 0), at(1, 0), { sourceSide: "top", targetSide: "top" })).toEqual({ sourceSide: "top", targetSide: "top" });
    expect(pickSides(at(0, 0), at(0, 2), { sourceSide: "right" }).sourceSide).toBe("right");
    expect(pickSides(at(0, 0), at(0, 2), { sourceSide: "bottom" }).targetSide).toBe("top");
    expect(pickSides(at(0, 0), at(1, 0), { targetSide: "bottom" }).targetSide).toBe("bottom");
  });
});

describe("facingSide", () => {
  const r = card(100, 100);
  it("faces the point", () => {
    expect(facingSide(r, { x: 0, y: 130 })).toBe("left");
    expect(facingSide(r, { x: 500, y: 130 })).toBe("right");
    expect(facingSide(r, { x: 200, y: 0 })).toBe("top");
    expect(facingSide(r, { x: 200, y: 400 })).toBe("bottom");
    expect(facingSide(r, { x: 105, y: 136 })).toBe("left"); // inside: nearest edge
  });
});

describe("laneOffset", () => {
  it("puts reverse twins on opposite lanes", () => {
    expect(laneOffset("right", "left").y).toBeLessThan(0);
    expect(laneOffset("left", "right").y).toBeGreaterThan(0);
    expect(laneOffset("bottom", "top").x).toBeGreaterThan(0);
    expect(laneOffset("top", "bottom").x).toBeLessThan(0);
    expect(laneOffset("right", "top")).toEqual({ x: 0, y: 0 });
  });
});
