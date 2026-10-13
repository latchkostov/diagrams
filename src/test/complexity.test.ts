import { describe, expect, it } from "vitest";
import { calibrate, countingReads, growth, MAX_REPS } from "./complexity";

/** Busy-waits `ms` (a call that really takes that long). */
const spin = (ms: number) => {
  const end = performance.now() + ms;
  while (performance.now() < end);
};

describe("growth's calibration", () => {
  it("sizes batches from warmed-up calls, not one slow first call", () => {
    // The first call is slow (compiling, a collection), the rest take microseconds: a batch must still reach
    // minMs, or the samples measure a call shorter than the timer's resolution.
    let calls = 0;
    const run = () => {
      if (calls++ === 0) spin(20);
      else spin(0.002);
    };
    const reps = calibrate(run, 4);
    expect(reps).toBeGreaterThan(1);
    const start = performance.now();
    for (let i = 0; i < reps; i++) run();
    expect(performance.now() - start).toBeGreaterThanOrEqual(4);
  });

  it("stops at MAX_REPS for a call too cheap to time", () => {
    expect(calibrate(() => undefined, 1e6)).toBe(MAX_REPS);
  });

  it("tells linear from quadratic", () => {
    const linear = (n: number) => () => {
      let s = 0;
      for (let i = 0; i < n; i++) s += i;
      return s;
    };
    const quadratic = (n: number) => () => {
      let s = 0;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) s += j;
      return s;
    };
    expect(growth(linear(20_000), linear(160_000))).toBeLessThan(24);
    expect(growth(quadratic(200), quadratic(1_600))).toBeGreaterThan(24);
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
