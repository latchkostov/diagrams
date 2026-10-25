import { createMachine, defineMachine } from "../../lib/machine";

export const messageCardMachine = defineMachine<{ value: "open" | "dismissed" }, { type: "escape" }>({
  initial: { value: "open" },
  states: ["open", "dismissed"],
  events: [{ type: "escape" }],
  on: { open: { escape: { target: "dismissed" } } },
});

/** One focused edge's card lifetime. Refocusing mounts a fresh reader; dismissal never replays a canvas key. */
export function createMessageCard() {
  const machine = createMachine(messageCardMachine);
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => machine.state.value === "open",
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    escape() {
      if (machine.state.value !== "open") return false;
      machine.send({ type: "escape" });
      for (const listener of listeners) listener();
      return true;
    },
  };
}
