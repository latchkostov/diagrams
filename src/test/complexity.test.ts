import { describe, expect, it, vi } from "vitest";
import { calibrate, countingReads, MAX_REPS } from "./complexity";

describe("growth's calibration", () => {
  it("sizes batches from warmed-up calls, not one slow first call", () => {
    // The first call is slow (compiling, a collection), the rest take microseconds: a batch must still reach
    // minMs, or the samples measure a call shorter than the timer's resolution. A fake clock each call advances, so
    // the sizing is checked exactly (timing real calls made this test the flaky kind it guards against).
    let now = 0;
    let calls = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    try {
      const reps = calibrate(() => (now += calls++ === 0 ? 20 : 0.002), 4);
      // Sized from the cold call, one repetition would do (20 ms >= 4); warmed up, it takes 2,000 of 0.002 ms.
      expect(reps * 0.002).toBeGreaterThanOrEqual(4);
    } finally {
      clock.mockRestore();
    }
  });

  it("stops at MAX_REPS for a call too cheap to time", () => {
    expect(calibrate(() => undefined, 1e6)).toBe(MAX_REPS);
  });
});

describe("countingReads", () => {
  it("counts the elements handed out, not the length", () => {
    const { items, reads } = countingReads([1, 2, 3]);
    expect(items.length).toBe(3);
    expect(items.slice(0, 2)).toEqual([1, 2]);
    expect(reads()).toBe(2);
  });
});
