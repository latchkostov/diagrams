// Live view's benchmark arithmetic (tests/bench/ui/live.bench.ts, docs/BENCHMARKS.md § Live view on large diagrams):
// pure, so `pnpm test` checks the parsing and the gates without a browser.

/**
 * Edges that change between active and idle per publish, per 100 edges, at most (× 10, the same window). Without the
 * hold (decorations.ts, EDGE_HOLD) a busy edge flips on most publishes.
 */
export const LIVE_FLIPS_PER_100_EDGES_LIMIT = 5;
/**
 * CSS transitions running at once at Traffic × 10, per 100 decorated nodes and edges, at most. A large diagram drops
 * the per-element fades (decorations.ts, LARGE_LIVE_ELEMENTS); with them, hundreds ran at once.
 */
export const LIVE_TRANSITIONS_PER_100_LIMIT = 1;
/** Consecutive frames within the settle bound that end the slow phase. */
export const LIVE_SETTLE_FRAMES = 8;
/** A frame is slow while it takes over this many times the steady frame. */
export const LIVE_SETTLE_FACTOR = 2;
/** The steady state: the last this-many ms of frames. */
export const LIVE_STEADY_WINDOW_MS = 5_000;

/** A `LayerTree.layerTreeDidChange` payload's layer count; null for the empty payload sent when the tree goes away. */
export function layerCount(event: { layers?: readonly unknown[] }): number | null {
  return event.layers?.length ? event.layers.length : null;
}

/** Peak over base (reported, not gated); a missing (zero or absent) side reads as Infinity. */
export function layerRatio(base: number, peak: number): number {
  return base > 0 && peak > 0 ? peak / base : Infinity;
}

export function frameGaps(frames: readonly number[]): number[] {
  return frames.slice(1).map((t, i) => t - frames[i]);
}

function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN;
}

/** The last `windowMs` of frames: their median gap, and whether none of them was slow (the transient is over). */
export function steadyTail(frames: readonly number[], windowMs = LIVE_STEADY_WINDOW_MS) {
  const end = frames[frames.length - 1];
  const tail = frames.filter((t) => t >= end - windowMs);
  const gaps = frameGaps(tail);
  const gap = median(gaps);
  const stable =
    gaps.length >= LIVE_SETTLE_FRAMES &&
    end - frames[0] >= 2 * windowMs &&
    gaps.every((g) => g <= LIVE_SETTLE_FACTOR * gap);
  return { gapMs: gap, fps: gap > 0 ? 1000 / gap : 0, stable };
}

/**
 * The transient after Traffic × 10, from the frames' timestamps (the first is the switch): how long until frames stay
 * within LIVE_SETTLE_FACTOR of the steady frame (`steadyGapMs`, the tail's median) for LIVE_SETTLE_FRAMES frames,
 * and the frame rate until then. Unsettled: the whole recording was the slow phase.
 */
export function slowPhase(frames: readonly number[], steadyGapMs: number) {
  const gaps = frameGaps(frames);
  const bound = LIVE_SETTLE_FACTOR * steadyGapMs;
  let run = 0;
  for (let i = 0; i < gaps.length; i++) {
    run = gaps[i] <= bound ? run + 1 : 0;
    if (run === LIVE_SETTLE_FRAMES) {
      const end = i + 1 - LIVE_SETTLE_FRAMES;
      const ms = frames[end] - frames[0];
      return { slowPhaseMs: ms, slowPhaseFps: ms > 0 ? (end * 1000) / ms : 0, settled: true };
    }
  }
  const ms = frames.length > 1 ? frames[frames.length - 1] - frames[0] : 0;
  return { slowPhaseMs: ms, slowPhaseFps: ms > 0 ? (gaps.length * 1000) / ms : 0, settled: false };
}

/** `count` per 100 of `of`; nothing to count against fails any `<=` gate. */
export function per100(count: number, of: number): number {
  return of > 0 ? (count / of) * 100 : Infinity;
}

/** Edges flipped per publish, per 100 edges; no publishes observed fails any `<=` gate. */
export function flipsPer100Edges(flips: number, publishes: number, edges: number): number {
  return publishes > 0 && edges > 0 ? (flips / publishes / edges) * 100 : Infinity;
}
