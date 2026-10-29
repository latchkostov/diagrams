// Calmer slow speeds: below 1×, draw whole journeys of a sample of messages instead of every dot.
// Speed changes how fast dots move, not how many there are, so 0.25× used to show the same 110–165
// dots as 1×. The sampler keeps about 24 on screen at 0.25× and 48 at 0.5×. It's a drawing limit
// only: counters, badges, scale, capacity and recordings never see it. Pure (no DOM).
//
// A message family (a root and its fan-out copies) is in or out as a whole, decided once when it's
// first seen and kept until it leaves the screen, so a sampled message stays visible on every hop
// and nothing pops in or out mid-edge. Retries and dead letters are always drawn (rare and telling).

import type { Particle } from "../../sim/types";

/** Dots to aim for on screen, by speed. At 1× and above nothing is thinned. */
export const CALM_TARGETS: readonly (readonly [speed: number, dots: number])[] = [
  [0.25, 24],
  [0.5, 48],
];

/** The target for a speed: 24 at 0.25×, 48 at 0.5×, none (Infinity) from 1×. */
export function calmTarget(speed: number): number {
  if (!(speed < 1)) return Infinity;
  for (const [s, d] of CALM_TARGETS) if (speed <= s) return d;
  return CALM_TARGETS.at(-1)![1];
}

/** k = 2^round(log2(max(1, count / target))): draw one family in k. */
export function idealStride(count: number, target: number): number {
  if (!Number.isFinite(target) || target <= 0 || !(count > target)) return 1;
  return 2 ** Math.round(Math.log2(Math.max(1, count / target)));
}

/** A stable, well-mixed hash of a root id (consecutive ids land far apart). */
export function familyHash(rootId: number): number {
  let h = Math.imul(rootId ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Recompute at most this often (ms), and move k one doubling or halving per step. */
export const CALM_INTERVAL = 1000;
/** Hysteresis around the rounding points (±25%). */
export const CALM_HYSTERESIS = 0.25;

export class CalmSampler {
  /** Current stride: one family in `k` is drawn. */
  k = 1;
  #speed = 1;
  #lastAt = -Infinity;
  /** The first plan after a speed change goes straight to the ideal stride. */
  #fresh = true;
  #decided = new Map<number, boolean>();
  #seen = new Set<number>();

  setSpeed(speed: number): void {
    if (speed === this.#speed) return;
    this.#speed = speed;
    // A new speed re-plans at once (it's an explicit choice), straight to the ideal stride.
    this.#lastAt = -Infinity;
    this.#fresh = true;
    if (!(speed < 1)) {
      this.k = 1;
      this.#decided.clear();
    }
  }

  get active(): boolean {
    return this.#speed < 1;
  }

  /**
   * Call once per frame with every particle (sampled units). Re-plans k at most once a second:
   * one doubling when well over the target, one halving when well under it.
   */
  begin(particles: readonly Particle[], now: number): void {
    if (!this.active) return;
    if (now - this.#lastAt >= CALM_INTERVAL) {
      this.#lastAt = now;
      const target = calmTarget(this.#speed);
      if (this.#fresh) {
        this.#fresh = false;
        this.k = idealStride(particles.length, target);
      }
      const drawn = particles.length / this.k;
      const up = target * Math.SQRT2 * (1 + CALM_HYSTERESIS);
      const down = (target / Math.SQRT2) * (1 - CALM_HYSTERESIS);
      if (drawn > up) this.k *= 2;
      else if (drawn < down && this.k > 1) this.k /= 2;
      // Never further than one step from the ideal (a sudden burst still converges a step a second).
      this.k = Math.max(1, Math.min(this.k, idealStride(particles.length, target) * 2));
    }
    // Forget families no longer on screen (their decision ends with their journey).
    const seen = this.#seen;
    seen.clear();
    for (const p of particles) seen.add(p.rootId);
    if (this.#decided.size > seen.size * 2 + 64)
      for (const root of this.#decided.keys()) if (!seen.has(root)) this.#decided.delete(root);
  }

  /**
   * Whether to draw this particle. `focus` (a traced family) is always drawn. A family's decision is
   * kept at every stride, 1 included: a family drawn while traffic was light stays drawn when it
   * grows, and one left out stays out when it drains.
   */
  keep(p: Particle, focus?: number): boolean {
    if (!this.active || p.rootId === focus || p.kind === "retry" || p.kind === "dlq") return true;
    let on = this.#decided.get(p.rootId);
    if (on === undefined) {
      on = familyHash(p.rootId) % this.k === 0;
      this.#decided.set(p.rootId, on);
    }
    return on;
  }
}
