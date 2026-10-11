/** Shared simulation clock: frame boundaries never determine action/check timestamps. */
export const SIM_TICK_MS = 10;
export function clampSpeed(value: number, previous = 1): number {
  return Number.isFinite(value) ? Math.max(0.25, Math.min(8, value)) : previous;
}

export function createScheduler() {
  let credit = 0;
  return {
    reset() {
      credit = 0;
    },
    advance(simMs: number, tick: () => boolean | undefined) {
      if (!Number.isFinite(simMs) || simMs <= 0) return;
      credit += simMs;
      while (credit + 1e-8 >= SIM_TICK_MS) {
        credit = Math.max(0, credit - SIM_TICK_MS);
        if (tick() === false) {
          credit = 0;
          break;
        }
      }
    },
  };
}
