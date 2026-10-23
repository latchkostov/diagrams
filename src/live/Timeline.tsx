import { useMemo, useRef, useState, type CSSProperties } from "react";
import type { Simulation } from "../model/types";
import type { SimulationRunState } from "../sim/types";
import { useInteraction } from "../canvas/interaction";
import { t } from "../i18n";
import { isolate } from "./bidi";
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
 * Scrubber for a saved simulation: traffic windows as bands, notes / fault actions as markers,
 * progress fill and a playhead. Dragging seeks (runs are seeded, so going back replays exactly).
 */
export function Timeline({
  sim,
  run,
  onSeek,
  disabled = false,
}: {
  sim: Simulation;
  run: SimulationRunState;
  onSeek: (ms: number) => void;
  disabled?: boolean;
}) {
  const interaction = useInteraction();
  const total = trackLength(run.totalMs, run.time);
  const bands = useMemo(() => trafficBands(sim, total), [sim, total]);
  const markers = useMemo(() => placeMarkers(run.markers, total), [run.markers, total]);
  const [drag, setDrag] = useState<number | null>(null);
  const [activeMarker, setActiveMarker] = useState(0);
  const markerRefs = useRef<(HTMLButtonElement | null)[]>([]);
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
        // A click jumps there (just past the marker, so its note shows or its fault has happened).
        <button
          type="button"
          key={`${m.atMs}-${i}`}
          className={`lv-marker is-${m.kind}`}
          style={{ left: pct(m.at), "--row": m.row } as CSSProperties}
          title={t("resilience.timelineJump", { time: isolate(formatClock(m.atMs)), label: m.label })}
          aria-label={t("resilience.timelineJump", { time: isolate(formatClock(m.atMs)), label: m.label })}
          aria-current={i === Math.min(activeMarker, markers.length - 1) ? "step" : undefined}
          tabIndex={i === Math.min(activeMarker, markers.length - 1) ? 0 : -1}
          ref={(el) => {
            markerRefs.current[i] = el;
          }}
          onKeyDown={(event) => {
            const delta =
              event.key === "ArrowRight" || event.key === "ArrowDown"
                ? 1
                : event.key === "ArrowLeft" || event.key === "ArrowUp"
                  ? -1
                  : 0;
            if (!delta && event.key !== "Home" && event.key !== "End") return;
            event.preventDefault();
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? markers.length - 1
                  : (i + delta + markers.length) % markers.length;
            setActiveMarker(next);
            const target = markerRefs.current[next];
            if (target) interaction?.dispatch({ type: "node.details", source: "timeline", target });
            pending.current = null;
            setDrag(null);
            onSeek(markerSeekTime(markers[next].atMs));
          }}
          data-testid={`live-marker-${i}`}
          data-at={m.atMs}
          disabled={disabled}
          onClick={() => {
            setActiveMarker(i);
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
        tabIndex={markers.length ? -1 : 0}
        aria-label={t("resilience.simulationTime")}
        aria-valuetext={formatClock(fractionToTime(progress, total))}
        data-testid="live-timeline-input"
        name="live-timeline"
        disabled={disabled}
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
