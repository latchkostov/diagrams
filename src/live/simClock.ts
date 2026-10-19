/**
 * The simulation's tick (src/sim/scheduler.ts SIM_TICK_MS), written here so the room's code that paces a follower
 * imports nothing the live view's chunk does (simClock.test.ts checks they agree).
 */
export const TICK_MS = 10;

// How far a live run moves each frame (shared Live design, P1). Alone, it moves as the frame clock says
// (./frameClock.ts). A follower in shared Live (P2) tracks the driver instead: it aims for the driver's tick minus a
// playout delay, running up to 5% faster or slower than its frames to close the gap, and never past the target.
// Results don't depend on how the ticks are chunked into frames (src/sim/scheduler.ts), so changing the pace changes
// only when a tick runs, never what it does.

export interface RunClock {
  /** The run's tick now. */
  tick: number;
  /** Its speed: simulated ms per wall ms. */
  speed: number;
}

export interface SimClock {
  /** Wall ms the run advances this frame, given what the frame clock proposes. */
  pace(proposedMs: number, run: RunClock): number;
}

/** Live on its own: exactly the frame clock's pace. */
export const OWN_CLOCK: SimClock = { pace: (ms) => ms };

/** The most a follower runs faster or slower than its frames, as a fraction. */
export const FOLLOW_RATE = 0.05;

/**
 * Follows `target()`, the tick to aim for (undefined: nothing to follow, so hold). Behind by more than this frame
 * would move, it runs FOLLOW_RATE faster; within one frame of the target, FOLLOW_RATE slower, and it stops there.
 */
export function createFollowClock(target: () => number | undefined, rate = FOLLOW_RATE): SimClock {
  return {
    pace(proposedMs, run) {
      const goal = target();
      if (goal === undefined || !(proposedMs > 0) || !(run.speed > 0)) return 0;
      const behind = (goal - run.tick) * TICK_MS;
      if (behind <= 0) return 0;
      const sim = proposedMs * run.speed;
      const paced = behind > sim ? sim * (1 + rate) : sim * (1 - rate);
      return Math.min(paced, behind) / run.speed;
    },
  };
}
