import { describe, expect, it } from "vitest";
import { isValidHex, normalizeHex, QUICK_PALETTE, THEME_PALETTE, SPECTRUM_GRID } from "./colorPalette";

describe("colorPalette", () => {
  describe("isValidHex", () => {
    it("accepts 3, 4, 6, and 8 digit hex codes with or without #", () => {
      expect(isValidHex("#fff")).toBe(true);
      expect(isValidHex("fff")).toBe(true);
      expect(isValidHex("#3b82f6")).toBe(true);
      expect(isValidHex("3B82F6")).toBe(true);
      expect(isValidHex("#ffff")).toBe(true);
      expect(isValidHex("#3b82f6ff")).toBe(true);
    });

    it("rejects non-hex strings or wrong length", () => {
      expect(isValidHex("")).toBe(false);
      expect(isValidHex("#")).toBe(false);
      expect(isValidHex("#ff")).toBe(false);
      expect(isValidHex("#fffff")).toBe(false);
      expect(isValidHex("#xyz123")).toBe(false);
      expect(isValidHex("blue")).toBe(false);
    });
  });

  describe("normalizeHex", () => {
    it("normalizes valid hex strings to uppercase #RRGGBB or #RGB", () => {
      expect(normalizeHex("3b82f6")).toBe("#3B82F6");
      expect(normalizeHex("#3b82f6")).toBe("#3B82F6");
      expect(normalizeHex("#abc")).toBe("#ABC");
      expect(normalizeHex("abc")).toBe("#ABC");
    });

    it("returns null for invalid inputs", () => {
      expect(normalizeHex("not-a-color")).toBeNull();
      expect(normalizeHex("#12")).toBeNull();
    });
  });

  describe("palette grids", () => {
    it("contains 9 quick colors", () => {
      expect(QUICK_PALETTE).toHaveLength(9);
      for (const hex of QUICK_PALETTE) {
        expect(isValidHex(hex)).toBe(true);
      }
    });

    it("contains 2 theme rows with 10 columns each", () => {
      expect(THEME_PALETTE).toHaveLength(2);
      for (const row of THEME_PALETTE) {
        expect(row).toHaveLength(10);
        for (const hex of row) {
          expect(isValidHex(hex)).toBe(true);
        }
      }
    });

    it("contains 10 spectrum rows with 10 columns each", () => {
      expect(SPECTRUM_GRID).toHaveLength(10);
      for (const row of SPECTRUM_GRID) {
        expect(row).toHaveLength(10);
        for (const hex of row) {
          expect(isValidHex(hex)).toBe(true);
        }
      }
    });
  });
});
