// When the checks run while editing: after the edits pause (a debounce), then in the browser's idle time, and
// one run at a time with only the newest diagram queued behind it. Pure timing; what runs is `run`. Typing and
// dragging only ever reset a timer, so they never wait on a check.

export interface IdleApi {
  request(fn: () => void, timeoutMs: number): number;
  cancel(id: number): void;
}

/** requestIdleCallback where the browser has it (Safari doesn't); else a timeout. */
export const browserIdle: IdleApi =
  typeof requestIdleCallback === "function"
    ? { request: (fn, timeout) => requestIdleCallback(fn, { timeout }), cancel: (id) => cancelIdleCallback(id) }
    : {
        request: (fn) => setTimeout(fn, 0) as unknown as number,
        cancel: (id) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>),
      };

export interface SchedulerOptions {
  /** Quiet time after the last change before a run (the plan's ~400 ms). */
  delayMs?: number;
  /** The longest an idle callback may wait once the delay is over. */
  idleTimeoutMs?: number;
  idle?: IdleApi;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

export interface CheckScheduler {
  /** Something changed: run after `delayMs` of quiet (or `delayMs` given here, e.g. longer on first load). */
  schedule(delayMs?: number): void;
  /** Run as soon as the browser is idle, skipping the debounce (the card just opened). */
  now(): void;
  /** Drop what's waiting; a run in flight finishes but its result is still delivered by `run`'s caller. */
  cancel(): void;
  /** True while a run is in flight or waiting. */
  busy(): boolean;
}

/**
 * `run` is called with no overlap: if a change comes while one is in flight, exactly one more run follows it
 * (with whatever is newest by then), however many changes came meanwhile.
 */
export function createCheckScheduler(run: () => Promise<void>, opts: SchedulerOptions = {}): CheckScheduler {
  const delay = opts.delayMs ?? 400;
  const idleTimeout = opts.idleTimeoutMs ?? 1000;
  const idle = opts.idle ?? browserIdle;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  let timer: unknown;
  let idleId: number | undefined;
  let inFlight = false;
  let again = false;

  const clear = () => {
    if (timer !== undefined) clearTimer(timer);
    if (idleId !== undefined) idle.cancel(idleId);
    timer = idleId = undefined;
  };
  const start = () => {
    idleId = undefined;
    if (inFlight) {
      again = true;
      return;
    }
    inFlight = true;
    void run()
      .catch(() => {})
      .finally(() => {
        inFlight = false;
        if (again) {
          again = false;
          toIdle();
        }
      });
  };
  const toIdle = () => {
    timer = undefined;
    if (idleId === undefined) idleId = idle.request(start, idleTimeout);
  };
  return {
    schedule(ms = delay) {
      clear();
      timer = setTimer(toIdle, ms);
    },
    now() {
      clear();
      toIdle();
    },
    cancel() {
      clear();
      again = false;
    },
    busy: () => inFlight || timer !== undefined || idleId !== undefined,
  };
}
