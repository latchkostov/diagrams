import type { Clock } from "../../../../src/collab/clock";

/** A token bucket on a clock: `capacity` at most, refilled at `perMs`. */
export class TokenBucket {
  private tokens: number;
  private at: number;
  constructor(
    private capacity: number,
    private perMs: number,
    private clock: Clock,
  ) {
    this.tokens = capacity;
    this.at = clock.now();
  }
  take(amount: number): boolean {
    const now = this.clock.now();
    this.tokens = Math.min(this.capacity, this.tokens + Math.max(0, now - this.at) * this.perMs);
    this.at = now;
    if (amount > this.tokens) return false;
    this.tokens -= amount;
    return true;
  }
}
