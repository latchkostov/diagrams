import { describe, expect, it } from "vitest";
import { TOAST_BOTTOM, toastBottom } from "./toastStack";
import { feedbackPlacement } from "./toastFeedback";

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

describe("feedbackPlacement", () => {
  // 44px of feedback needs 64px of room: 10px either side of it.
  it("puts a dialog's feedback below its panel when the window has room there", () => {
    expect(feedbackPlacement({ bottom: 600 }, 44, 900)).toBe("below");
    expect(feedbackPlacement({ bottom: 836 }, 44, 900)).toBe("below");
  });

  it("goes inside a panel that leaves less room than that", () => {
    expect(feedbackPlacement({ bottom: 837 }, 44, 900)).toBe("inside");
    expect(feedbackPlacement({ bottom: 884 }, 44, 900)).toBe("inside");
  });
});
