// How far each animation frame moves live view's clocks.
//
// The simulation steps in fixed 10 ms ticks however long a frame is (sim/scheduler.ts, engine.step), so a longer step
// replays the same ticks and stays deterministic; seeking already steps up to a second at a time (controller.ts). A
// frame used to move the simulation at most 100 ms, which kept a background tab from jumping ahead when it came back,
// but also made simulated time run 33 times slower than the clock when the page drew a frame every 3.3 s (5,000 nodes
// at Traffic × 10 on a slow CPU), which stretched every slow phase by as much.
//
// Now:
// - a slow frame catches the simulation up, up to CATCH_UP_MS, but only as far as the engine can afford: its own work
//   may take at most ENGINE_SHARE of the frame. When the frame is slow because of drawing (the case above), the engine
//   is a small part of it and the simulation keeps the clock's pace; when the engine itself is what makes frames slow
//   (thousands of nodes, every one of them busy), catching up would only make each frame slower, so it steps as before;
// - a frame after the page was hidden (another tab, a minimised window) moves nothing, so the simulation resumes where
//   it was instead of jumping by the time away or by a full catch-up;
// - everything drawn by the wall clock (slow motion's replay, the marching edges) keeps the 100 ms step, so a slow
//   frame never skips part of a replay.

/** The most a frame moves what is drawn by the wall clock, and the least a slow frame moves the simulation. */
export const FRAME_STEP_MS = 100;
/** The most one frame moves the simulation. */
export const CATCH_UP_MS = 1_000;
/** The share of a frame the engine's catch-up may take. */
export const ENGINE_SHARE = 0.5;

export interface FrameStep {
  /** Wall-clock ms the simulation advances (the controller applies the speed). */
  sim: number;
  /** Wall-clock ms for what is drawn at the clock's pace. */
  visual: number;
}

export interface FrameClock {
  step(now: number): FrameStep;
  /** What advancing the simulation by `simMs` cost, in ms: how far the next slow frame can afford to catch up. */
  spent(simMs: number, engineMs: number): void;
  /** The page was hidden: the frame that follows starts afresh instead of catching up. */
  hidden(): void;
}

export function createFrameClock(start: number): FrameClock {
  let last = start;
  let resumed = false;
  /** Engine ms per simulated ms, smoothed over the last few frames (0 before the first reading). */
  let cost = 0;
  return {
    step(now) {
      const gap = Math.max(0, now - last);
      last = now;
      if (resumed) {
        resumed = false;
        return { sim: 0, visual: 0 };
      }
      const affordable = cost > 0 ? (ENGINE_SHARE * gap) / cost : Infinity;
      return {
        sim: Math.min(gap, CATCH_UP_MS, Math.max(FRAME_STEP_MS, affordable)),
        visual: Math.min(FRAME_STEP_MS, gap),
      };
    },
    spent(simMs, engineMs) {
      if (!(simMs > 0) || !(engineMs >= 0)) return;
      const c = engineMs / simMs;
      cost = cost > 0 ? (cost + c) / 2 : c;
    },
    hidden() {
      resumed = true;
    },
  };
}
