import { memo, useEffect, useRef, useState } from "react";
import type { LiveState } from "./controller";
import { SPEEDS } from "./controller";
import { useLive } from "./context";
import { formatClock, formatCount, formatSpeed } from "./format";
import { LiveIcon } from "./icons";
import { Timeline } from "./Timeline";
import type { ExpectationState } from "../sim/types";

/**
 * The floating bar while live: one row with the essentials (play / pause, restart, speed, the
 * simulation and its timeline + expectation dots). Traffic, step, the event log and authoring sit
 * behind "⋯" and in the right-click menu. Leaving live view is the Live toggle (or L, or Esc):
 * one way out, not two buttons.
 */
export function ControlBar({ state }: { state: LiveState }) {
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

  return (
    <div className="lv-bar" data-testid="live-controls" data-editor-overlay data-done={done ? "1" : undefined}>
      <button
        className="lv-btn lv-play"
        onClick={() => (waiting ? c.resume() : c.togglePlaying())}
        title={waiting ? "Continue (Space)" : state.playing ? "Pause (Space)" : done ? "Play again" : "Play (Space)"}
        aria-label={state.playing && !waiting ? "Pause" : "Play"}
        data-testid="live-play"
        data-state={waiting ? "waiting" : state.playing ? "playing" : done ? "done" : "paused"}
      >
        <LiveIcon name={state.playing && !waiting ? "pause" : "play"} size={15} />
      </button>
      <button
        className="lv-btn"
        onClick={() => c.restart()}
        title="Restart (same seed)"
        aria-label="Restart"
        data-testid="live-restart"
      >
        <LiveIcon name="restart" size={15} />
      </button>

      <label className="lv-select lv-speed" title="Playback speed">
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

      {state.simulation && run ? (
        <>
          <span
            className="lv-clock mono"
            data-testid="live-clock"
            data-ms={Math.round(run.time)}
            title={`of ${formatClock(Math.max(run.totalMs, run.time))}`}
          >
            {formatClock(run.time)}
          </span>
          <Timeline sim={state.simulation} run={run} onSeek={(ms) => c.seek(ms)} />
          {expectations.length > 0 && (
            <div
              className={`lv-checks${done ? (failed ? " is-fail" : " is-pass") : ""}`}
              data-testid="live-expectations"
              title={`${passed} of ${expectations.length} expectations hold`}
            >
              {expectations.map((e) => (
                <ExpectationDot key={e.id} e={e} />
              ))}
            </div>
          )}
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

      <span
        className="lv-stat mono"
        title="Messages travelling, queued or being processed"
        data-testid="live-in-system"
        data-count={state.snapshot.inSystem}
      >
        <strong>{formatCount(state.snapshot.inSystem)}</strong> in flight
      </span>

      <MoreMenu state={state} />
      {ui.notice && (
        <div className="lv-notice" role="status" data-testid="live-notice">
          {ui.notice}
        </div>
      )}
    </div>
  );
}

/** The "⋯" overflow: the less common controls. */
function MoreMenu({ state }: { state: LiveState }) {
  const ui = useLive();
  const c = ui.controller;
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const waiting = !!state.run?.waiting;
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  const pick =
    (fn: () => void, keepOpen = false) =>
    () => {
      fn();
      if (!keepOpen) setOpen(false);
    };

  return (
    <div className="lv-more" ref={root}>
      <button
        className={`lv-btn${open ? " is-on" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="More"
        aria-label="More live controls"
        data-testid="live-more"
      >
        <LiveIcon name="more" size={15} />
      </button>
      {open && (
        <div className="lv-more-menu" role="menu" data-testid="live-more-menu">
          <button
            role="menuitemcheckbox"
            aria-checked={state.traffic}
            onClick={pick(() => c.setTraffic(!state.traffic), true)}
            data-testid="live-traffic"
          >
            <LiveIcon name="traffic" size={14} />
            <span>Continuous traffic</span>
            <i className={`lv-switch${state.traffic ? " is-on" : ""}`} aria-hidden />
          </button>
          <button
            role="menuitem"
            onClick={pick(() => c.step(), true)}
            disabled={waiting || !!state.run?.done}
            data-testid="live-step"
          >
            <LiveIcon name="step" size={14} />
            <span>Step ¼ second</span>
          </button>
          <button
            role="menuitemcheckbox"
            aria-checked={ui.events.open}
            onClick={pick(() => ui.showEvents(ui.events.nodeId, !ui.events.open))}
            data-testid="live-events-toggle"
          >
            <LiveIcon name="events" size={14} />
            <span>Event log</span>
          </button>
          {ui.canEdit && !ui.presenting && (
            <button
              role="menuitem"
              onClick={pick(() => ui.openPanel(state.simulation ?? undefined))}
              data-testid="live-edit-sims"
            >
              <LiveIcon name="edit" size={14} />
              <span>{state.simulation ? "Edit this simulation" : "Simulations…"}</span>
            </button>
          )}
          <div className="lv-more-hint">Right-click any node to inject messages, start a storm or break things.</div>
        </div>
      )}
    </div>
  );
}

const ExpectationDot = memo(function ExpectationDot({ e }: { e: ExpectationState }) {
  const value = Number.isInteger(e.value) ? formatCount(e.value) : e.value.toFixed(1);
  const word = e.status === "pass" ? "holds" : e.status === "fail" ? "failed" : "pending";
  return (
    <span
      className={`lv-exp is-${e.status}`}
      data-testid={`expectation-${e.id}`}
      data-status={e.status}
      data-value={e.value}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Focus exposes an informational tooltip to keyboard users; it has no button action.
      tabIndex={0}
      aria-label={`${e.label}: ${word}, now ${value}`}
    >
      {e.status === "pass" ? (
        <LiveIcon name="check" size={10} />
      ) : e.status === "fail" ? (
        <LiveIcon name="x" size={10} />
      ) : null}
      <span className="lv-exp-tip" role="tooltip">
        <b>{e.label}</b>
        <span>
          {word} · now <span className="mono">{value}</span>
        </span>
      </span>
    </span>
  );
});
