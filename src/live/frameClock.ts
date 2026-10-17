// How far each animation frame moves live view's clocks.
//
// The simulation steps in fixed 10 ms ticks however long a frame is (sim/scheduler.ts, engine.step), so a longer step
// replays the same ticks and stays deterministic; seeking already steps up to a second at a time (controller.ts). A
// frame used to move the simulation at most 100 ms, which kept a background tab from jumping ahead when it came back,
// but also made simulated time run 33 times slower than the clock when the page drew a frame every 3.3 s (5,000 nodes
// at Traffic × 10 on a slow CPU), which stretched every slow phase by as much.
//
// Now:
// - the simulation catches up a slow frame, up to CATCH_UP_MS (bounding the engine's work in any one frame);
// - a frame after the page was hidden (another tab, a minimised window) moves nothing, so the simulation resumes where
//   it was instead of jumping by the time away or by a full catch-up;
// - everything drawn by the wall clock (slow motion's replay, the marching edges) keeps the 100 ms step, so a slow
//   frame never skips part of a replay.

/** The most a frame moves what is drawn by the wall clock: slow motion's replay and the marching edges. */
export const FRAME_STEP_MS = 100;
/** The most one frame moves the simulation: a frame slower than this still slows simulated time. */
export const CATCH_UP_MS = 1_000;

export interface FrameStep {
  /** Wall-clock ms the simulation advances (the controller applies the speed). */
  sim: number;
  /** Wall-clock ms for what is drawn at the clock's pace. */
  visual: number;
}

export interface FrameClock {
  step(now: number): FrameStep;
  /** The page was hidden: the frame that follows starts afresh instead of catching up. */
  hidden(): void;
}

export function createFrameClock(start: number): FrameClock {
  let last = start;
  let resumed = false;
  return {
    step(now) {
      const gap = Math.max(0, now - last);
      last = now;
      if (resumed) {
        resumed = false;
        return { sim: 0, visual: 0 };
      }
      return { sim: Math.min(CATCH_UP_MS, gap), visual: Math.min(FRAME_STEP_MS, gap) };
    },
    hidden() {
      resumed = true;
    },
  };
}
