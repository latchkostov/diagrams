// Pure mapping between simulation time and the scrubber, plus the marker and traffic-window data
// the timeline draws. Kept apart from the component so it can be unit-tested.

import type { Simulation } from "../model/types";
import type { TimelineMarker } from "../sim/types";
import { trafficWindow } from "../sim/simulation";

export const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** Fraction of the run elapsed (0..1). */
export function timeToFraction(timeMs: number, totalMs: number): number {
  return totalMs > 0 ? clamp01(timeMs / totalMs) : 0;
}

/** Scrubber position → simulation ms, snapped to the engine's 10 ms step. */
export function fractionToTime(fraction: number, totalMs: number): number {
  return Math.round((clamp01(fraction) * Math.max(0, totalMs)) / 10) * 10;
}

/** The run can be longer than estimated (a slow drain): stretch the track instead of overflowing. */
export function trackLength(totalMs: number, timeMs: number): number {
  return Math.max(totalMs, timeMs, 1);
}

export interface TrafficBand {
  id: string;
  label: string;
  /** Fractions of the track. */
  start: number;
  end: number;
  /** Bursts are instantaneous or short; drawn as a tick plus a short band. */
  burst: boolean;
}

export function trafficBands(sim: Simulation, totalMs: number): TrafficBand[] {
  return sim.traffic.map((p) => {
    const w = trafficWindow(p.shape);
    const start = timeToFraction(w.startMs, totalMs);
    // Give zero-length windows a visible sliver.
    const end = Math.max(start + 0.006, timeToFraction(w.endMs, totalMs));
    return {
      id: p.id,
      label: p.label ?? p.messageType ?? p.id,
      start,
      end: Math.min(1, end),
      burst: p.shape.kind === "burst",
    };
  });
}

export interface PlacedMarker extends TimelineMarker {
  /** Fraction of the track. */
  at: number;
  /** Markers closer than `minGap` are stacked: 0 = on the track, 1 = one row up... */
  row: number;
}

/**
 * Positions note / chaos markers (traffic is drawn as bands). Markers that would overlap get a
 * higher row so each stays hoverable.
 */
export function placeMarkers(markers: readonly TimelineMarker[], totalMs: number, minGap = 0.018): PlacedMarker[] {
  const out: PlacedMarker[] = [];
  const lastAtRow: number[] = [];
  for (const m of [...markers].filter((m) => m.kind !== "traffic").sort((a, b) => a.atMs - b.atMs)) {
    const at = timeToFraction(m.atMs, totalMs);
    let row = 0;
    while (lastAtRow[row] !== undefined && at - lastAtRow[row] < minGap) row++;
    lastAtRow[row] = at;
    out.push({ ...m, at, row: Math.min(row, 2) });
  }
  return out;
}

/** Where a click on a marker seeks: one engine step past it, so the note is up or the chaos has happened. */
export function markerSeekTime(atMs: number): number {
  return Math.max(0, Math.round((Number.isFinite(atMs) ? atMs : 0) / 10) * 10 + 10);
}

/** "note" → the glyph used on the track. */
export const markerGlyph: Record<TimelineMarker["kind"], string> = {
  note: "note",
  status: "chaos",
  props: "tweak",
  inject: "inject",
  trace: "trace",
  traffic: "traffic",
};
