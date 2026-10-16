// Replay protection for one sender's counters: a sliding window (as IPsec and DTLS use) that accepts each counter
// once, tolerates reordering up to `size` behind the highest seen, and refuses anything older. `check` is pure
// (a frame is checked before it's decrypted); `accept` records the counter only after the frame authenticated, so
// a forged frame can't burn a counter or move the window.

export type ReplayVerdict = "ok" | "replay" | "stale" | "invalid";

export class ReplayWindow {
  private highest = 0;
  /** Bit i set: counter (highest - i) was seen. */
  private seen: Uint32Array;

  constructor(private readonly size: number) {
    if (!Number.isInteger(size) || size < 32 || size % 32) throw new Error("A replay window is a multiple of 32.");
    this.seen = new Uint32Array(size / 32);
  }

  check(counter: number): ReplayVerdict {
    if (!Number.isSafeInteger(counter) || counter < 1) return "invalid";
    if (counter > this.highest) return "ok";
    const back = this.highest - counter;
    if (back >= this.size) return "stale";
    return this.bit(back) ? "replay" : "ok";
  }

  accept(counter: number): void {
    if (this.check(counter) !== "ok") throw new Error("ReplayWindow.accept: counter not acceptable");
    if (counter > this.highest) {
      this.shift(counter - this.highest);
      this.highest = counter;
      this.set(0);
    } else this.set(this.highest - counter);
  }

  get latest(): number {
    return this.highest;
  }

  private bit(i: number): boolean {
    return (this.seen[i >>> 5] & (1 << (i & 31))) !== 0;
  }

  private set(i: number): void {
    this.seen[i >>> 5] |= 1 << (i & 31);
  }

  /** Ages every recorded counter by `n` (bits past the window fall off). */
  private shift(n: number): void {
    if (n >= this.size) {
      this.seen.fill(0);
      return;
    }
    const words = n >>> 5;
    const bitsN = n & 31;
    const len = this.seen.length;
    for (let w = len - 1; w >= 0; w--) {
      const src = w - words;
      const lo = src >= 0 ? this.seen[src] : 0;
      const prev = src - 1 >= 0 ? this.seen[src - 1] : 0;
      this.seen[w] = bitsN === 0 ? lo : ((lo << bitsN) | (prev >>> (32 - bitsN))) >>> 0;
    }
  }
}
