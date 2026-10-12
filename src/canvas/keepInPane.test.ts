import { describe, expect, it } from "vitest";
import { clampShift } from "./keepInPane";

describe("clampShift: an enlarged editor moves back inside the pane", () => {
  it("leaves one that fits alone", () => expect(clampShift(100, 300, 8, 1000)).toBe(0));
  it("moves one past the far edge back by its overflow", () => expect(clampShift(900, 1100, 8, 1000)).toBe(-100));
  it("moves one before the near edge forward", () => expect(clampShift(-40, 160, 8, 1000)).toBe(48));
  it("shows the start of one bigger than the pane", () => expect(clampShift(-40, 2000, 8, 1000)).toBe(48));
});
