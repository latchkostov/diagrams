import { useInteraction } from "../canvas/interaction";
import { SimPanel } from "./lazySimPanel";
import { t, useLocale } from "../i18n";
import { memo, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { LiveState } from "./controller";
import { SPEEDS } from "./controller";
import { useLive, type TraceChoice } from "./context";
import { formatClock, formatCount, formatSpeed, formatScale } from "./format";
import { LiveIcon } from "./icons";
import { Timeline } from "./Timeline";
import { PANEL_OPENER_ATTR } from "./usePanelEscape";
import { useLivePopover } from "./useLivePopover";
import { SlowBar } from "./slowmo/SlowBar";
import type { ExpectationState } from "../sim/types";
import { liveMutationGuard } from "./liveActions";

/**
 * The floating bar while live: one row with the essentials (play / pause, restart, speed, the
 * simulation and its timeline + expectation dots). Traffic, step, the event log and authoring sit
 * behind "⋯" and in the right-click menu. Leaving live view is the Live toggle (or L, or Esc):
 * one way out, not two buttons.
 */
export function ControlBar({ state }: { state: LiveState }) {
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
      className={`lv-bar${slowOn ? " is-slowmo" : ""}`}
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

      {slowOn ? (
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
                className="lv-clock mono"
                data-testid="live-clock"
                data-ms={Math.round(run.time)}
                title={`of ${formatClock(Math.max(run.totalMs, run.time))}`}
              >
                {formatClock(run.time)}
              </span>
              <Timeline
                sim={state.simulation}
                run={run}
                onSeek={(ms) => c.seek(ms)}
                disabled={lookingAhead || state.needsRestart}
              />
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
              {expectations.length > 0 && (
                <ExpectationSummary expectations={expectations} passed={passed} failed={failed} done={done} />
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
        </>
      )}

      <span
        className="lv-stat mono"
        title={`Messages travelling, queued or being processed${state.scale > 1 ? ` (real messages; 1 dot ≈ ${formatScale(state.scale)})` : ""}`}
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

/** Below 1×, fewer dots are drawn (slowmo/sampler.ts); the counts never change. */
const SPEED_HINT = "Playback speed. Slower speeds draw fewer dots so each one is easy to follow; counts stay exact.";

/** The "⋯" overflow: the less common controls. */
/** Same words as the right-click's "Trace a message ▸" (src/live/liveActions.ts). */
const TRACE_CHOICES: readonly (readonly [TraceChoice, string])[] = [
  ["slowmo", "Next message, in slow motion"],
  ["next", "Next message"],
  ["slowest", "Slowest so far"],
  ["deadletter", "One that dead-lettered"],
];

function MoreMenu({ state }: { state: LiveState }) {
  const interaction = useInteraction();
  const ui = useLive();
  const c = ui.controller;
  const button = useRef<HTMLButtonElement>(null);
  const { open, toggle, close } = useLivePopover(() => button.current);
  const [traceOpen, setTraceOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const waiting = !!state.run?.waiting;
  const slowStatus = useSyncExternalStore(ui.slowmo.subscribe, ui.slowmo.getState, ui.slowmo.getState).status;
  const slowOn = slowStatus === "on";
  const mutations = liveMutationGuard(() => ui.slowmo.active);
  const traffic = ui.action("sim.traffic");
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
  const pick =
    (fn: () => void, keepOpen = false) =>
    () => {
      fn();
      if (!keepOpen) {
        close("pick");
        setTraceOpen(false);
      }
    };

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
      {open && (
        <div
          className="lv-more-menu"
          role="menu"
          tabIndex={-1}
          data-testid="live-more-menu"
          onKeyDown={(e) => {
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
            e.preventDefault();
            const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            const next =
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? items.length - 1
                  : (index + (e.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
            if (items[next]) interaction?.dispatch({ type: "dialog.tab", target: items[next] });
          }}
        >
          <button
            role="menuitemcheckbox"
            aria-checked={state.traffic}
            onClick={pick(() => (traffic ? traffic.run?.() : c.setTraffic(!state.traffic)), true)}
            disabled={traffic?.disabled ?? !mutations.enabled()}
            title={traffic?.hint ?? mutations.hint()}
            data-testid="live-traffic"
          >
            <LiveIcon name="traffic" size={14} />
            <span>Continuous traffic</span>
            <i className={`lv-switch${state.traffic ? " is-on" : ""}`} aria-hidden />
          </button>
          {slowOn ? (
            <button role="menuitem" onClick={pick(() => ui.slowmo.step(1), true)} data-testid="live-step">
              <LiveIcon name="step" size={14} />
              <span>Next hop</span>
              <kbd>→</kbd>
            </button>
          ) : (
            <button
              role="menuitem"
              onClick={pick(() => c.step(), true)}
              disabled={state.needsRestart || waiting || !!state.run?.done || slowStatus === "capturing"}
              data-testid="live-step"
            >
              <LiveIcon name="step" size={14} />
              <span>Step ¼ second</span>
            </button>
          )}
          <button
            role="menuitemcheckbox"
            aria-checked={ui.events.open}
            onClick={pick(() => ui.showEvents(ui.events.nodeId, !ui.events.open))}
            data-testid="live-events-toggle"
          >
            <LiveIcon name="events" size={14} />
            <span>Event log</span>
          </button>
          {/* The same three ways in as the right-click's "Trace a message ▸", unfolded in place. */}
          <button
            role="menuitem"
            aria-expanded={traceOpen}
            onClick={() => setTraceOpen((o) => !o)}
            data-testid="live-trace-message"
          >
            <LiveIcon name="trace" size={14} />
            <span>Trace a message</span>
            <i className={`lv-more-fold${traceOpen ? " is-open" : ""}`} aria-hidden>
              <LiveIcon name="chevron" size={12} />
            </i>
          </button>
          {traceOpen && (
            <div className="lv-more-sub" role="group" aria-label="Trace a message">
              {TRACE_CHOICES.map(([which, label]) => (
                <button
                  key={which}
                  role="menuitem"
                  onClick={pick(() => ui.startTrace(which))}
                  data-testid={`live-trace-${which}`}
                >
                  <span>{label}</span>
                </button>
              ))}
            </div>
          )}
          <button role="menuitem" onClick={pick(() => ui.openRecord())} data-testid="live-record">
            <LiveIcon name="record" size={14} />
            <span>Record video…</span>
          </button>
          {ui.canEdit && !ui.presenting && (
            <button
              role="menuitem"
              onClick={pick(() => ui.openPanel(state.simulation ?? undefined))}
              disabled={!mutations.enabled()}
              title={mutations.hint()}
              data-testid="live-edit-sims"
            >
              <LiveIcon name="edit" size={14} />
              <span>{state.simulation ? "Edit this simulation" : "Simulations…"}</span>
            </button>
          )}
          <div className="lv-more-hint">{mutations.hint() ?? t("liveMenu.faultHint")}</div>
        </div>
      )}
    </div>
  );
}

/**
 * A narrow bar has no room for the dots: "2/3" opens the same results as a list (each with its
 * name, state and value), so nothing is lost to keyboard and screen-reader users.
 */
function ExpectationSummary({
  expectations,
  passed,
  failed,
  done,
}: {
  expectations: readonly ExpectationState[];
  passed: number;
  failed: boolean;
  done: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  // Esc gives focus back to the summary button (focus policy row M5).
  const { open, toggle, close } = useLivePopover(() => button.current);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => !root.current?.contains(e.target as Node) && close("outside");
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close("escape");
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", esc, true);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", esc, true);
    };
  }, [open, close]);
  const tone = failed ? " is-fail" : done ? " is-pass" : "";
  return (
    <div className="lv-checks-more" ref={root}>
      <button
        ref={button}
        className={`lv-checks-sum${tone}`}
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Expectations: ${passed} of ${expectations.length} hold${failed ? ", some failed" : ""}. Show each`}
        data-testid="live-expectations-summary"
      >
        <LiveIcon name={failed ? "x" : "check"} size={11} />
        <span className="mono">
          {passed}/{expectations.length}
        </span>
      </button>
      {open && (
        <div className="lv-checks-pop" role="dialog" aria-label="Expectations" data-testid="live-expectations-list">
          <ul>
            {expectations.map((e) => {
              const value = Number.isInteger(e.value) ? formatCount(e.value) : e.value.toFixed(1);
              const word = e.status === "pass" ? "holds" : e.status === "fail" ? "failed" : "pending";
              return (
                <li key={e.id} className={`is-${e.status}`} data-testid={`expectation-row-${e.id}`}>
                  <span className={`lv-exp is-${e.status}`} aria-hidden>
                    {e.status === "pass" ? (
                      <LiveIcon name="check" size={10} />
                    ) : e.status === "fail" ? (
                      <LiveIcon name="x" size={10} />
                    ) : null}
                  </span>
                  <b>{e.label}</b>
                  <span>
                    {word} · now <span className="mono">{value}</span>
                  </span>
                </li>
              );
            })}
          </ul>
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
