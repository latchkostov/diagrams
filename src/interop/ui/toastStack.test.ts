import { describe, expect, it } from "vitest";
import { TOAST_BOTTOM, toastBottom } from "./toastStack";

describe("toastBottom", () => {
  const toast = { left: 400, right: 800 };
  it("rests at the bottom when nothing is in the way", () => {
    expect(toastBottom(toast, [], 900)).toBe(TOAST_BOTTOM);
    // A bar beside the toast, or high up, isn't in its way.
    expect(toastBottom(toast, [{ left: 0, right: 380, top: 840, bottom: 880 }], 900)).toBe(TOAST_BOTTOM);
    expect(toastBottom(toast, [{ left: 0, right: 1400, top: 60, bottom: 100 }], 900)).toBe(TOAST_BOTTOM);
  });

  it("stacks above every bar it would cover", () => {
    const hint = { left: 300, right: 900, top: 836, bottom: 872 };
    const live = { left: 100, right: 1000, top: 820, bottom: 882 };
    expect(toastBottom(toast, [hint], 900)).toBe(900 - 836 + 10);
    expect(toastBottom(toast, [hint, live], 900)).toBe(900 - 820 + 10);
  });
});
