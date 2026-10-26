import { useSyncExternalStore, type Dispatch, type SetStateAction, type ReactNode } from "react";
import { useInteraction, type MenuCloseReason } from "../canvas/interaction";
import { t } from "../i18n";
import type { LiveState } from "./controller";
import { useLive, type TraceChoice } from "./context";
import { LiveIcon } from "./icons";
import { liveMutationGuard } from "./liveActions";

const TRACE_CHOICES: readonly (readonly [TraceChoice, string])[] = [
  ["slowmo", "Next message, in slow motion"],
  ["next", "Next message"],
  ["slowest", "Slowest so far"],
  ["deadletter", "One that dead-lettered"],
];

export function LiveMoreItems({
  state,
  close,
  traceOpen,
  setTraceOpen,
  children,
}: {
  state: LiveState;
  close(reason: MenuCloseReason): void;
  traceOpen: boolean;
  setTraceOpen: Dispatch<SetStateAction<boolean>>;
  children?: ReactNode;
}) {
  const interaction = useInteraction();
  const ui = useLive();
  const c = ui.controller;
  const waiting = !!state.run?.waiting;
  const slowStatus = useSyncExternalStore(ui.slowmo.subscribe, ui.slowmo.getState, ui.slowmo.getState).status;
  const slowOn = slowStatus === "on";
  const mutations = liveMutationGuard(() => ui.slowmo.active);
  const traffic = ui.action("sim.traffic");
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
      {children}
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
  );
}
