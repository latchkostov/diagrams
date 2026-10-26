import { defineLazySurface } from "../lib/lazySurface";
const LiveMoreItems = defineLazySurface({
  id: "live.more",
  load: () => import("./LiveMoreItems").then((m) => m.LiveMoreItems),
  placeholder: {
    render: (_, status) => (
      <div className="lv-more-menu" role="menu" data-testid="live-more-menu" aria-busy={!status.failed}>
        {status.failed ? t("fileDialog.loadFailed") : t("common.loading")}
      </div>
    ),
  },
  focus: {},
  export: "skip",
  retryToast: true,
});
import { SimPanel } from "./lazySimPanel";
import { t, useLocale } from "../i18n";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { LiveState } from "./controller";
import { SPEEDS } from "./controller";
import { useLive } from "./context";
import { formatClock, formatSeconds, formatCount, formatSpeed, formatScale } from "./format";
import { LiveIcon } from "./icons";
import { Timeline } from "./lazyTimeline";
import { PANEL_OPENER_ATTR } from "./usePanelEscape";
import { useLivePopover } from "./useLivePopover";
import { SlowBar } from "./slowmo/SlowBar";

/**
 * The floating bar while live: one row with the essentials (play / pause, restart, speed, the
 * simulation and its timeline + expectation dots). Traffic, step, the event log and authoring sit
 * behind "⋯" and in the right-click menu. Leaving live view is the Live toggle (or L, or Esc):
 * one way out, not two buttons.
 */
export function ControlBar({ state, slim = false }: { state: LiveState; slim?: boolean }) {
  useLocale();
  const ui = useLive();
  const c = ui.controller;
  const run = state.run;
  const waiting = !!run?.waiting;
  const done = !!run?.done;
  const simId = state.simulation?.id ?? "";
  const options = [...ui.simulations];
  if (ui.draft && !options.some((s) => s.id === ui.draft!.id)) options.push(ui.draft);
  const expectations = run?.expectations ?? [];
  const passed = expectations.filter((e) => e.status === "pass").length;
  const failed = expectations.some((e) => e.status === "fail");
  // Slow motion: play, restart and the timeline drive the replay; live is paused meanwhile. While it
  // records the journey ahead (a few frames), live's own controls wait (the controller is held).
  const slow = useSyncExternalStore(ui.slowmo.subscribe, ui.slowmo.getState, ui.slowmo.getState);
  const slowOn = slow.status === "on";
  const lookingAhead = slow.status === "capturing";

  return (
    <div
      className={`lv-bar${slim ? " is-slim" : ""}${slowOn ? " is-slowmo" : ""}`}
      data-testid="live-controls"
      data-editor-overlay
      data-toast-avoid
      data-done={done ? "1" : undefined}
    >
      {slowOn ? (
        <button
          className="lv-btn lv-play"
          onClick={() => ui.slowmo.toggle()}
          title={slow.playing ? "Pause the slow motion (Space)" : slow.done ? "Replay" : "Play the slow motion (Space)"}
          aria-label={slow.playing ? "Pause" : "Play"}
          data-testid="live-play"
          data-state="slowmo"
          data-playing={slow.playing ? "1" : "0"}
        >
          <LiveIcon name={slow.playing ? "pause" : "play"} size={15} />
        </button>
      ) : (
        <button
          className="lv-btn lv-play"
          onClick={() => (waiting ? c.resume() : c.togglePlaying())}
          disabled={lookingAhead || state.needsRestart}
          title={waiting ? "Continue (Space)" : state.playing ? "Pause (Space)" : done ? "Play again" : "Play (Space)"}
          aria-label={state.playing && !waiting ? "Pause" : "Play"}
          data-testid="live-play"
          data-state={waiting ? "waiting" : state.playing ? "playing" : done ? "done" : "paused"}
        >
          <LiveIcon name={state.playing && !waiting ? "pause" : "play"} size={15} />
        </button>
      )}
      <button
        className="lv-btn"
        onClick={() => (slowOn ? ui.slowmo.restart() : c.restart())}
        disabled={lookingAhead}
        title={slowOn ? "Replay the slow motion from the start" : "Restart (same seed)"}
        aria-label={slowOn ? "Replay" : "Restart"}
        data-testid="live-restart"
      >
        <LiveIcon name="restart" size={15} />
      </button>

      <label className="lv-select lv-speed" title={slowOn ? "Slow motion pace" : SPEED_HINT}>
        <span className="sr-only">Speed</span>
        <select
          value={String(state.speed)}
          onChange={(e) => c.setSpeed(Number(e.target.value))}
          data-testid="live-speed"
          name="live-speed"
        >
          {SPEEDS.map((s) => (
            <option key={s} value={String(s)}>
              {formatSpeed(s)}
            </option>
          ))}
        </select>
      </label>

      {slowOn || slow.loading ? (
        <SlowBar slow={ui.slowmo} />
      ) : (
        <>
          <label className="lv-select lv-sim" title="Choose a saved simulation, or free play">
            <span className="sr-only">Simulation</span>
            <select
              value={simId}
              onChange={(e) => ui.selectSimulation(e.target.value || null)}
              data-testid="live-sim-picker"
              name="live-sim"
            >
              <option value="">Free play</option>
              {options.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                  {ui.draft?.id === s.id ? " (unsaved)" : ""}
                </option>
              ))}
            </select>
            <LiveIcon name="chevron" size={11} />
          </label>

          <button
            className={`lv-btn lv-inputs${ui.capacityOpen ? " is-on" : ""}`}
            onClick={() => ui.openCapacity(!ui.capacityOpen)}
            aria-pressed={ui.capacityOpen}
            aria-label="Inputs"
            title={t("broker.inputs")}
            data-testid="live-capacity"
          >
            <LiveIcon name="gauge" size={15} />
            <span>Inputs</span>
          </button>

          {state.simulation && run ? (
            <>
              <span
                className="lv-clock"
                data-testid="live-clock"
                data-ms={Math.round(run.time)}
                title={`of ${formatClock(Math.max(run.totalMs, run.time))}`}
              >
                {formatSeconds(run.time)}
              </span>
              <span className="lv-clock-total" data-testid="live-clock-total">
                / {formatSeconds(run.totalMs)}
              </span>
              <InFlight state={state} />
              <Timeline
                sim={state.simulation}
                run={run}
                onSeek={(ms) => c.seek(ms)}
                disabled={lookingAhead || state.needsRestart}
              />
              {done && (
                <span
                  className={`lv-done${failed ? " is-fail" : " is-pass"}`}
                  data-testid="live-done"
                  data-status={failed ? "fail" : "pass"}
                >
                  <LiveIcon name={failed ? "x" : "check"} size={12} />
                  {expectations.length ? `${passed}/${expectations.length}` : "Done"}
                </span>
              )}
            </>
          ) : (
            <span className="lv-grow" />
          )}
        </>
      )}

      {!state.run && <InFlight state={state} />}

      <MoreMenu state={state} />
      {ui.notice && (
        <div className="lv-notice" role="status" data-testid="live-notice">
          {ui.notice}
        </div>
      )}
    </div>
  );
}

/** Below 1×, fewer dots are drawn (slowmo/sampler.ts); the counts never change. */
const SPEED_HINT = "Playback speed. Slower speeds draw fewer dots so each one is easy to follow; counts stay exact.";

/** The "⋯" overflow: the less common controls. */
/** Same words as the right-click's "Trace a message ▸" (src/live/liveActions.ts). */

function MoreMenu({ state }: { state: LiveState }) {
  const [traceOpen, setTraceOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const { open, toggle, close } = useLivePopover(() => button.current);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    SimPanel.preload();
    const outside = (e: PointerEvent) => !root.current?.contains(e.target as Node) && close("outside");
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close("escape");
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", esc);
    };
  }, [open, close]);

  return (
    <div className="lv-more" ref={root}>
      <button
        ref={button}
        className={`lv-btn${open ? " is-on" : ""}`}
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        title="More"
        aria-label="More live controls"
        data-testid="live-more"
        {...{ [PANEL_OPENER_ATTR]: "" }}
      >
        <LiveIcon name="more" size={15} />
      </button>
      {open && <LiveMoreItems state={state} close={close} traceOpen={traceOpen} setTraceOpen={setTraceOpen} />}
    </div>
  );
}

function InFlight({ state }: { state: LiveState }) {
  return (
    <span
      className="lv-stat"
      data-testid="live-in-system"
      data-count={state.snapshot.inSystem}
      title={`Messages travelling, queued or being processed${state.scale > 1 ? ` (real messages; 1 dot ≈ ${formatScale(state.scale)})` : ""}`}
    >
      {t("hover.inFlight")} <strong>{formatCount(state.snapshot.inSystem)}</strong>
    </span>
  );
}
