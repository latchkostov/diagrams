import { afterEach, describe, expect, it, vi } from "vitest";
import { readSheetWidth, saveSheetWidth, sheetBounds, sheetWidth, SHEET_WIDTH_KEY } from "./sheetWidth";

afterEach(() => vi.unstubAllGlobals());

describe("inspector width", () => {
  it.each([
    [1366, 362],
    [1440, 382],
    [1920, 509],
    [2560, 640],
    [3440, 640],
  ])("scales the default at %ipx to %ipx", (viewport, expected) => {
    expect(sheetWidth(viewport)).toBe(expected);
  });
  it("bounds manual widths by 60vw and the canvas room after other panels", () => {
    expect(sheetBounds(1920, 1600)).toEqual({ min: 300, max: 1120 });
    expect(sheetWidth(1920, 1600, 2000)).toBe(1120);
    expect(sheetWidth(1920, 1600, 200)).toBe(300);
    expect(sheetWidth(3440, 3440, 3000)).toBe(2064);
    expect(sheetWidth(1000, 700, 600)).toBe(296);
    expect(sheetWidth(900, 652)).toBe(296);
    expect(sheetWidth(1200, 780, 600)).toBe(300);
  });
  it("keeps narrow layouts at their original width regardless of preference", () => {
    expect(sheetWidth(800, 500, 900)).toBe(296);
    expect(sheetWidth(390, 390)).toBe(296);
  });
  it("remembers a device preference and clears it on reset", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => values.set(k, v),
      removeItem: (k: string) => values.delete(k),
    });
    expect(readSheetWidth()).toBeNull();
    saveSheetWidth(700);
    expect(readSheetWidth()).toBe(700);
    expect(sheetWidth(1200, 1000, readSheetWidth())).toBe(520);
    expect(readSheetWidth()).toBe(700); // Shrinking never overwrites the person's choice.
    saveSheetWidth(null);
    expect(values.has(SHEET_WIDTH_KEY)).toBe(false);
    expect(sheetWidth(1920, 1920, readSheetWidth())).toBe(509);
  });
  it.each(["", " ", "NaN", "Infinity", "-1", "0", "oops"])("ignores invalid storage %j", (value) => {
    vi.stubGlobal("localStorage", { getItem: () => value });
    expect(readSheetWidth()).toBeNull();
  });
  it("works when storage is unavailable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    expect(readSheetWidth()).toBeNull();
    expect(() => saveSheetWidth(600)).not.toThrow();
    expect(() => saveSheetWidth(null)).not.toThrow();
  });
});
