import { describe, expect, it } from "vitest";
import { MARGIN, menuLeft } from "./menuPlacement";

// A menu panel's left edge (./menuPlacement.ts): on screen, whichever side a submenu opens.

describe("menuLeft", () => {
  it("a submenu that fits opens beside its parent", () => {
    expect(menuLeft(316, 300, 20, 1280)).toBe(316); // to the right
    expect(menuLeft(684, 300, 980, 1280)).toBe(684); // to the left (right to left)
  });

  it("flips to the other side when its own has no room", () => {
    expect(menuLeft(1076, 300, 780, 1280)).toBe(484); // no room on the right: left of the parent
    expect(menuLeft(-284, 300, 12, 1280)).toBe(308); // right to left, no room on the left: right of the parent
  });

  it("stays in the window when neither side has room, overlapping its parent", () => {
    // 500 px window, 300 px panels, the parent at 192: right is past the edge, left is past the other.
    const l = menuLeft(488, 300, 192, 500);
    expect(l).toBeGreaterThanOrEqual(MARGIN);
    expect(l + 300).toBeLessThanOrEqual(500 - MARGIN);
    const r = menuLeft(-104, 300, 192, 500);
    expect(r).toBeGreaterThanOrEqual(MARGIN);
    expect(r + 300).toBeLessThanOrEqual(500 - MARGIN);
  });

  it("a root menu is kept in the window", () => {
    expect(menuLeft(-40, 320, undefined, 1280)).toBe(MARGIN);
    expect(menuLeft(1200, 320, undefined, 1280)).toBe(1280 - 320 - MARGIN);
  });
});
