// The room's notion of time: presence expiry, heartbeats, anti-entropy and rate limits all read it, never
// Date.now() or setInterval directly, so tests drive them with a fake clock and no test waits for real time.

export interface Clock {
  now(): number;
  /** Calls `fn` every `ms` until the returned function is called. */
  every(ms: number, fn: () => void): () => void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  every(ms, fn) {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  },
};

/** A clock that only moves when `advance` is called; due timers run in time order. */
export class FakeClock implements Clock {
  private t: number;
  private timers = new Map<number, { at: number; ms: number; fn: () => void }>();
  private next = 1;

  constructor(start = 0) {
    this.t = start;
  }

  now(): number {
    return this.t;
  }

  every(ms: number, fn: () => void): () => void {
    if (!(ms > 0)) throw new Error("FakeClock.every needs a positive interval");
    const id = this.next++;
    this.timers.set(id, { at: this.t + ms, ms, fn });
    return () => {
      this.timers.delete(id);
    };
  }

  /** Moves time forward by `ms`, running every timer that falls due on the way (each as often as it's due). */
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      let due: [number, { at: number; ms: number; fn: () => void }] | undefined;
      for (const entry of this.timers) if (entry[1].at <= end && (!due || entry[1].at < due[1].at)) due = entry;
      if (!due) break;
      const [, timer] = due;
      this.t = timer.at;
      timer.at += timer.ms;
      timer.fn();
    }
    this.t = end;
  }

  /** Timers still scheduled (a session that left has none). */
  get pending(): number {
    return this.timers.size;
  }
}
