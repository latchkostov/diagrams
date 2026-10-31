import { useEffect, useState, useSyncExternalStore } from "react";
import { createMachine, defineMachine } from "../lib/machine";

export const COACH_NUDGE_MS = 40_000;
interface HelpState {
  value: "waiting" | "nudged";
  route: number;
  hint: boolean;
  folded: boolean;
}
type HelpEvent = { type: "progress" | "elapsed" | "hint" | "fold" } | { type: "route"; route: number };
export const coachHelpMachine = defineMachine<HelpState, HelpEvent>({
  initial: { value: "waiting", route: 0, hint: false, folded: false },
  states: ["waiting", "nudged"],
  on: {
    "*": {
      progress: { target: "waiting" },
      hint: [
        { target: "waiting", guard: (s) => s.value === "waiting", reduce: (s) => ({ ...s, hint: !s.hint }) },
        { target: "nudged", reduce: (s) => ({ ...s, hint: !s.hint }) },
      ],
      fold: [
        { target: "waiting", guard: (s) => s.value === "waiting", reduce: (s) => ({ ...s, folded: !s.folded }) },
        { target: "nudged", reduce: (s) => ({ ...s, folded: !s.folded }) },
      ],
      route: { target: "waiting", reduce: (s, e) => ({ ...s, route: e.route, hint: false, folded: false }) },
    },
    waiting: { elapsed: { target: "nudged" } },
  },
  events: [{ type: "progress" }, { type: "elapsed" }, { type: "hint" }, { type: "fold" }, { type: "route", route: 1 }],
});

/** The timer belongs to a mounted step, and never performs an action on the learner's behalf. */
export function createCoachHelp(clock: Pick<typeof globalThis, "setTimeout" | "clearTimeout"> = globalThis) {
  const machine = createMachine(coachHelpMachine);
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let connected = false;
  const cancel = () => {
    clock.clearTimeout(timer);
    timer = undefined;
  };
  const arm = () => {
    cancel();
    if (connected) timer = clock.setTimeout(() => send({ type: "elapsed" }), COACH_NUDGE_MS);
  };
  const send = (event: HelpEvent) => {
    machine.send(event);
    if (event.type === "progress" || event.type === "route") arm();
    for (const listener of listeners) listener();
  };
  return {
    send,
    progress: () => send({ type: "progress" }),
    getSnapshot: () => machine.state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    connect() {
      connected = true;
      send({ type: "progress" });
      return () => {
        connected = false;
        cancel();
      };
    },
  };
}

export function useCoachHelp(waiting: boolean) {
  const [help] = useState(createCoachHelp);
  const state = useSyncExternalStore(help.subscribe, help.getSnapshot);
  useEffect(() => (waiting ? help.connect() : undefined), [help, waiting]);
  // Typing is meaningful activity even when the next control hasn't appeared yet. Moving the camera is not.
  useEffect(() => {
    if (!waiting) return;
    document.addEventListener("input", help.progress);
    return () => document.removeEventListener("input", help.progress);
  }, [help, waiting]);
  return { ...help, state };
}
