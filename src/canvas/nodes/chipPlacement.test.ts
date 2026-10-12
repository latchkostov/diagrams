import { describe, expect, it } from "vitest";
import { CHIP_ORDER, chipRect, freeSide } from "./chipPlacement";

const card = { left: 100, top: 100, right: 320, bottom: 172 };

describe("the + chip's side", () => {
  it("sits 16 px off the card, centred on the side", () => {
    expect(chipRect(card, "right", 0)).toEqual({ left: 336, top: 126, right: 356, bottom: 146 });
    expect(chipRect(card, "bottom", 0)).toEqual({ left: 200, top: 188, right: 220, bottom: 208 });
    expect(chipRect(card, "left", 0)).toEqual({ left: 64, top: 126, right: 84, bottom: 146 });
    expect(chipRect(card, "top", 0)).toEqual({ left: 200, top: 64, right: 220, bottom: 84 });
  });

  it("goes downstream when that side is free: right for left-to-right, bottom for top-to-bottom", () => {
    expect(freeSide(card, [], CHIP_ORDER.LR)).toBe("right");
    expect(freeSide(card, [], CHIP_ORDER.TB)).toBe("bottom");
  });

  it("moves to the next free side when a neighbour or an edge label is there", () => {
    const neighbour = { left: 340, top: 100, right: 560, bottom: 172 };
    const label = { left: 180, top: 180, right: 240, bottom: 200 };
    expect(freeSide(card, [neighbour], CHIP_ORDER.LR)).toBe("bottom");
    expect(freeSide(card, [neighbour, label], CHIP_ORDER.LR)).toBe("top");
  });

  it("goes on the card's own corner when every side is taken", () => {
    const all = (["right", "bottom", "top", "left"] as const).map((s) => chipRect(card, s));
    expect(freeSide(card, all, CHIP_ORDER.LR)).toBe("corner");
  });
});
