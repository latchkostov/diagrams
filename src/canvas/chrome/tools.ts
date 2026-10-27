import { useSyncExternalStore } from "react";
import { createMachine, defineMachine } from "../../lib/machine";
import type { ChecksStore } from "../checks/useChecks";

type Surface = "closed" | "library" | "annotate";
export const toolMachine = defineMachine<{ value: Surface }, { type: Surface }>({
  initial: { value: "closed" },
  states: ["closed", "library", "annotate"],
  events: [{ type: "closed" }, { type: "library" }, { type: "annotate" }],
  on: {
    "*": {
      closed: { target: "closed" },
      library: { target: "library" },
      annotate: { target: "annotate" },
    },
  },
});
const machine = createMachine(toolMachine);
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
export interface ToolHost {
  live: boolean;
  pinned: boolean;
  checks: ChecksStore;
  select(): void;
  shortcuts(): void;
}
let host: ToolHost | null = null;
/** The app rail talks to its mounted canvas without importing React Flow or field UI. */
export const tools = {
  get: () => machine.state.value,
  host: () => host,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
  open(value: Surface) {
    machine.send({ type: value });
    emit();
  },
  toggle(value: Exclude<Surface, "closed">) {
    tools.open(tools.get() === value ? "closed" : value);
  },
  connect(value: ToolHost) {
    host = value;
    if (value.live) machine.send({ type: "closed" });
    emit();
    return () => {
      if (host === value) {
        host = null;
        tools.open("closed");
      }
    };
  },
};
export const useToolSurface = () => useSyncExternalStore(tools.subscribe, tools.get, tools.get);
export const useToolHost = () => useSyncExternalStore(tools.subscribe, tools.host, tools.host);
