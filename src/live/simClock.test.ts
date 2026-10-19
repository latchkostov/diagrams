import { describe, expect, it } from "vitest";
import { SIM_TICK_MS } from "../sim/scheduler";
import { createFollowClock, FOLLOW_RATE, OWN_CLOCK, TICK_MS } from "./simClock";

describe("sim clocks", () => {
  it("count the simulation's own tick", () => {
    expect(TICK_MS).toBe(SIM_TICK_MS);
  });

  it("alone, a run moves exactly as the frame clock proposes", () => {
    expect(OWN_CLOCK.pace(16, { tick: 0, speed: 1 })).toBe(16);
    expect(OWN_CLOCK.pace(1000, { tick: 500, speed: 8 })).toBe(1000);
  });

  it("a follower far behind runs 5% faster than its frames; near the target 5% slower, and never past it", () => {
    let goal: number | undefined = 1000;
    const clock = createFollowClock(() => goal);
    // 10 s of simulated time behind, a 100 ms frame: 5% more.
    expect(clock.pace(100, { tick: 0, speed: 1 })).toBeCloseTo(100 * (1 + FOLLOW_RATE));
    // At 2× speed the wall ms halve for the same simulated pace.
    expect(clock.pace(100, { tick: 0, speed: 2 })).toBeCloseTo(100 * (1 + FOLLOW_RATE));
    // 80 ms behind, a 100 ms frame: 5% slower would overshoot, so it stops at the target.
    expect(clock.pace(100, { tick: 992, speed: 1 })).toBeCloseTo(80);
    // 200 ms behind, a 100 ms frame: still more than a frame away, so 5% faster.
    expect(clock.pace(100, { tick: 980, speed: 1 })).toBeCloseTo(105);
    // At or past the target, or with nothing to follow: it holds.
    expect(clock.pace(100, { tick: 1000, speed: 1 })).toBe(0);
    expect(clock.pace(100, { tick: 1200, speed: 1 })).toBe(0);
    goal = undefined;
    expect(clock.pace(100, { tick: 0, speed: 1 })).toBe(0);
  });
});
