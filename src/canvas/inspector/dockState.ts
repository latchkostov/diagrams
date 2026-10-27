import { useSyncExternalStore } from "react";
import { createMachine, defineMachine } from "../../lib/machine";
export type DockTab = "properties" | "checks" | "ai";
export type SheetSnap = "peek" | "half" | "full";
type View = DockTab | "closed";
interface State {
  value: View;
  last: DockTab;
  previous: View;
  snap: SheetSnap;
}
type Event = { type: DockTab | "close" | "back" } | { type: "snap"; value: SheetSnap };
export const dockMachine = defineMachine<State, Event>({
  initial: { value: "closed", last: "properties", previous: "closed", snap: "half" },
  states: ["closed", "properties", "checks", "ai"],
  events: [
    { type: "properties" },
    { type: "checks" },
    { type: "ai" },
    { type: "close" },
    { type: "back" },
    { type: "snap", value: "full" },
    { type: "snap", value: "half" },
    { type: "snap", value: "peek" },
  ],
  on: {
    "*": {
      snap: [
        { target: "closed", guard: (s) => s.value === "closed", reduce: (s, e) => ({ ...s, snap: e.value }) },
        { target: "properties", guard: (s) => s.value === "properties", reduce: (s, e) => ({ ...s, snap: e.value }) },
        { target: "checks", guard: (s) => s.value === "checks", reduce: (s, e) => ({ ...s, snap: e.value }) },
        { target: "ai", guard: (s) => s.value === "ai", reduce: (s, e) => ({ ...s, snap: e.value }) },
      ],
      properties: { target: "properties", reduce: (s) => ({ ...s, last: "properties" }) },
      ai: { target: "ai", reduce: (s) => ({ ...s, last: "ai" }) },
      checks: {
        target: "checks",
        guard: (s) => s.value !== "checks",
        reduce: (s) => ({ ...s, previous: s.value, last: "checks" }),
      },
      close: { target: "closed", reduce: (s) => ({ ...s, last: s.value === "closed" ? s.last : s.value }) },
    },
    checks: {
      back: [
        {
          target: "properties",
          guard: (s) => s.previous === "properties",
          reduce: (s) => ({ ...s, last: "properties" }),
        },
        { target: "ai", guard: (s) => s.previous === "ai", reduce: (s) => ({ ...s, last: "ai" }) },
        { target: "closed" },
      ],
    },
  },
});
const machine = createMachine(dockMachine);
const listeners = new Set<() => void>();
const send = (event: Event) => {
  const before = machine.state;
  machine.send(event);
  if (before !== machine.state) listeners.forEach((l) => l());
};
export const workbenchDock = {
  snap(value: SheetSnap) {
    send({ type: "snap", value });
  },
  get: () => machine.state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
  show(tab: DockTab) {
    if (machine.state.value !== tab) send({ type: tab });
  },
  close() {
    if (machine.state.value !== "closed") send({ type: "close" });
  },
  back() {
    send({ type: "back" });
  },
};
export const useWorkbenchDock = () =>
  useSyncExternalStore(workbenchDock.subscribe, workbenchDock.get, workbenchDock.get);
