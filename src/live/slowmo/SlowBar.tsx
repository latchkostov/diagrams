import { useSyncExternalStore, type CSSProperties } from "react";
import "../../styles/slowmo.css";
import { LiveIcon } from "../icons";
import type { SlowMotion } from "./session";

/** "0.43 s": journey time in real seconds, always two decimals so the clock doesn't jitter. */
const seconds = (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(2)} s`;

/**
 * The live bar's middle while slow motion plays: what's going on ("Slow motion · live paused"),
 * the journey clock in real time, and the replay's timeline with a tick per hop (scrub to any
 * moment). It stands in for the simulation picker and its timeline, so the bar gains no control.
 */
export function SlowBar({ slow }: { slow: SlowMotion }) {
  const s = useSyncExternalStore(slow.subscribe, slow.getState, slow.getState);
  const script = s.script;
  if (!script)
    return s.loading ? (
      // The script code is still downloading: live is held, and Esc gives it back.
      <span
        className="lv-slowmo-chip is-loading"
        role="status"
        aria-live="polite"
        data-testid="slowmo-loading"
        title="Live is paused until slow motion is ready. Esc goes back to live."
      >
        <LiveIcon name="slowmo" size={13} />
        <span>
          Loading slow motion…<span className="lv-slowmo-sep"> · </span>
          <span className="lv-slowmo-paused">Esc to cancel</span>
        </span>
      </span>
    ) : null;
  const total = Math.max(1, script.duration);
  const pct = (ms: number) => `${((ms / total) * 100).toFixed(3)}%`;
  return (
    <>
      <span
        className="lv-slowmo-chip"
        data-testid="slowmo-chip"
        title="Live is paused while slow motion replays one message. Esc goes back to live, where it left off."
      >
        <LiveIcon name="slowmo" size={13} />
        <span>
          Slow motion<span className="lv-slowmo-sep"> · </span>
          <span className="lv-slowmo-paused">live paused</span>
        </span>
      </span>
      <span
        className="lv-clock mono"
        data-testid="live-clock"
        data-mode="slowmo"
        data-ms={Math.round(s.real)}
        title="Journey time, in real (simulated) seconds"
      >
        {seconds(s.real)} / {seconds(script.realTotal)} real
      </span>
      <div
        className="lv-timeline lv-slowmo-timeline"
        data-testid="slowmo-timeline"
        style={{ "--p": pct(s.t) } as CSSProperties}
      >
        <div className="lv-track" aria-hidden>
          <span className="lv-fill" />
        </div>
        {script.stops.map((at) => (
          <span key={at} className="lv-slowmo-tick" style={{ left: pct(at) }} aria-hidden />
        ))}
        <span className="lv-playhead" aria-hidden />
        <input
          type="range"
          min={0}
          max={1000}
          step={1}
          value={Math.round((s.t / total) * 1000)}
          aria-label="Slow motion time"
          aria-valuetext={`${seconds(s.real)} of ${seconds(script.realTotal)} real`}
          data-testid="slowmo-timeline-input"
          name="slowmo-timeline"
          onChange={(e) => slow.seek((Number(e.target.value) / 1000) * total)}
        />
      </div>
    </>
  );
}

/** The latest caption, for screen readers (the canvas draws it for everyone else). */
export function SlowCaption({ slow }: { slow: SlowMotion }) {
  const s = useSyncExternalStore(slow.subscribe, slow.getState, slow.getState);
  if (s.status !== "on") return null;
  return (
    <div className="sr-only" role="status" aria-live="polite" data-testid="slowmo-caption">
      {s.caption}
    </div>
  );
}
