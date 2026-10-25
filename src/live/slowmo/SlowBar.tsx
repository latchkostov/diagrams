import { defineLazySurface } from "../../lib/lazySurface";
import { useSyncExternalStore } from "react";
import "../../styles/slowmo.css";
import { LiveIcon } from "../icons";
import type { SlowMotionApi } from "./controller";
const SlowTimeline = defineLazySurface({
  id: "live.slow-timeline",
  load: () => import("./SlowTimeline").then((m) => m.SlowTimeline),
  placeholder: { size: {}, testId: "live.slow-timeline-loading" },
  focus: {},
  export: "skip",
  retryToast: true,
});

/**
 * The live bar's middle while slow motion plays: what's going on ("Slow motion · live paused"),
 * the journey clock in real time, and the replay's timeline with a tick per hop (scrub to any
 * moment). It stands in for the simulation picker and its timeline, so the bar gains no control.
 */
export function SlowBar({ slow }: { slow: SlowMotionApi }) {
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
  return (
    <>
      <span
        className="lv-slowmo-chip"
        role="status"
        data-testid="slowmo-chip"
        title="Live is paused while slow motion replays one message. Esc goes back to live, where it left off."
      >
        <LiveIcon name="slowmo" size={13} />
        <span>
          Slow motion<span className="lv-slowmo-sep"> · </span>
          <span className="lv-slowmo-paused">live paused</span>
        </span>
      </span>
      <SlowTimeline slow={slow} state={s} />
    </>
  );
}

/** The latest caption, for screen readers (the canvas draws it for everyone else). */
export function SlowCaption({ slow }: { slow: SlowMotionApi }) {
  const s = useSyncExternalStore(slow.subscribe, slow.getState, slow.getState);
  if (s.status !== "on") return null;
  return (
    <div className="sr-only" role="status" aria-live="polite" data-testid="slowmo-caption">
      {s.caption}
    </div>
  );
}
