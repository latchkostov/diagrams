import type { CSSProperties } from "react";
import type { SlowMotion } from "./session";
import { LiveIcon } from "../icons";

/** Replay readouts load on use; play controls, screen-reader captions and Esc stay outside this chunk. */
export function SlowTimeline({ slow, state: s }: { slow: SlowMotion; state: ReturnType<SlowMotion["getState"]> }) {
  const script = s.script;
  if (!script) return null;
  const total = Math.max(1, script.duration);
  const pct = (ms: number) => `${((ms / total) * 100).toFixed(3)}%`;
  const seconds = (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(2)} s`;
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
