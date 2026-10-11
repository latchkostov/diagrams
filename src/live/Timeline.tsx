import { useMemo, useRef, useState, type CSSProperties } from "react";
import type { Simulation } from "../model/types";
import type { SimulationRunState } from "../sim/types";
import { formatClock } from "./format";
import {
  fractionToTime,
  markerSeekTime,
  placeMarkers,
  timeToFraction,
  trackLength,
  trafficBands,
} from "./timelineMath";

/**
 * Scrubber for a saved simulation: traffic windows as bands, notes / chaos actions as markers,
 * progress fill and a playhead. Dragging seeks (runs are seeded, so going back replays exactly).
 */
export function Timeline({
  sim,
  run,
  onSeek,
}: {
  sim: Simulation;
  run: SimulationRunState;
  onSeek: (ms: number) => void;
}) {
  const total = trackLength(run.totalMs, run.time);
  const bands = useMemo(() => trafficBands(sim, total), [sim, total]);
  const markers = useMemo(() => placeMarkers(run.markers, total), [run.markers, total]);
  const [drag, setDrag] = useState<number | null>(null);
  const pending = useRef<number | null>(null);
  const commit = () => {
    if (pending.current === null) return;
    const fraction = pending.current;
    pending.current = null;
    onSeek(fractionToTime(fraction, total));
    setDrag(null);
  };
  const progress = drag ?? timeToFraction(run.time, total);
  const pct = (f: number) => `${(f * 100).toFixed(3)}%`;

  return (
    <div className="lv-timeline" data-testid="live-timeline" style={{ "--p": pct(progress) } as CSSProperties}>
      <div className="lv-track" aria-hidden>
        {bands.map((b) => (
          <span
            key={b.id}
            className={`lv-band${b.burst ? " is-burst" : ""}`}
            style={{ left: pct(b.start), width: pct(b.end - b.start) }}
            title={b.label}
          />
        ))}
        <span className="lv-fill" />
      </div>
      {markers.map((m, i) => (
        // A click jumps there (just past the marker, so its note shows or its chaos has happened).
        // Keyboard users scrub with the slider; the markers stay out of the Tab order.
        <button
          type="button"
          tabIndex={-1}
          key={`${m.atMs}-${i}`}
          className={`lv-marker is-${m.kind}`}
          style={{ left: pct(m.at), "--row": m.row } as CSSProperties}
          title={`${formatClock(m.atMs)} · ${m.label} (click to jump here)`}
          aria-label={`Jump to ${formatClock(m.atMs)}: ${m.label}`}
          data-testid={`live-marker-${i}`}
          data-at={m.atMs}
          onClick={() => {
            pending.current = null;
            setDrag(null);
            onSeek(markerSeekTime(m.atMs));
          }}
        />
      ))}
      <span className="lv-playhead" aria-hidden />
      <input
        type="range"
        min={0}
        max={1000}
        step={1}
        value={Math.round(progress * 1000)}
        aria-label="Simulation time"
        aria-valuetext={formatClock(fractionToTime(progress, total))}
        data-testid="live-timeline-input"
        name="live-timeline"
        onChange={(e) => {
          const f = Number(e.target.value) / 1000;
          pending.current = f;
          setDrag(f);
        }}
        onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
        onPointerUp={commit}
        onLostPointerCapture={commit}
        onPointerCancel={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
    </div>
  );
}
