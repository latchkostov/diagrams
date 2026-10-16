// The room's notion of time: presence expiry, heartbeats, anti-entropy and rate limits all read it, never
// Date.now() or setInterval directly, so tests drive them with a fake clock and no test waits for real time.

export interface Clock {
  now(): number;
  /** Calls `fn` every `ms` until the returned function is called. */
  every(ms: number, fn: () => void): () => void;
  /** Calls `fn` once after `ms` unless the returned function is called first. */
  after(ms: number, fn: () => void): () => void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  every(ms, fn) {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  },
  after(ms, fn) {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  },
};

/** A clock that only moves when `advance` is called; due timers run in time order. */
export class FakeClock implements Clock {
  private t: number;
  private timers = new Map<number, { at: number; ms: number; fn: () => void; once?: boolean }>();
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

  after(ms: number, fn: () => void): () => void {
    const id = this.next++;
    this.timers.set(id, { at: this.t + Math.max(0, ms), ms, fn, once: true });
    return () => {
      this.timers.delete(id);
    };
  }

  /** Moves time forward by `ms`, running every timer that falls due on the way (each as often as it's due). */
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      let due: [number, { at: number; ms: number; fn: () => void; once?: boolean }] | undefined;
      for (const entry of this.timers) if (entry[1].at <= end && (!due || entry[1].at < due[1].at)) due = entry;
      if (!due) break;
      const [id, timer] = due;
      this.t = timer.at;
      if (timer.once) this.timers.delete(id);
      else timer.at += timer.ms;
      timer.fn();
    }
    this.t = end;
  }

  /** When the next timer falls due, if any. */
  nextDue(): number | undefined {
    let next: number | undefined;
    for (const t of this.timers.values()) if (next === undefined || t.at < next) next = t.at;
    return next;
  }

  /** Timers still scheduled (a session that left has none). */
  get pending(): number {
    return this.timers.size;
  }
}
