import { defineMachine } from "../../lib/machine";
import type { ElementHandle } from "../interaction/types";

type State = { value: "open" | "applied" | "cancelled" | "closed" };
type Event =
  { type: "apply"; accepted: boolean } | { type: "cancel" } | { type: "dispose"; opener: ElementHandle | null };
type Command = { type: "restore"; opener: ElementHandle | null; reason: "escape" | "unmount" };

/** Applying owns the next canvas focus; cancellation alone gives the dialog's opener back. */
export const areaDialogMachine = defineMachine<State, Event, Command>({
  initial: { value: "open" },
  states: ["open", "applied", "cancelled", "closed"],
  events: [
    { type: "apply", accepted: true },
    { type: "apply", accepted: false },
    { type: "cancel" },
    { type: "dispose", opener: null },
  ],
  on: {
    open: {
      apply: { target: "applied", guard: (_, e) => e.accepted },
      cancel: { target: "cancelled" },
      dispose: { target: "closed", effects: (_, e) => [{ type: "restore", opener: e.opener, reason: "unmount" }] },
    },
    applied: { dispose: { target: "closed" } },
    cancelled: {
      dispose: { target: "closed", effects: (_, e) => [{ type: "restore", opener: e.opener, reason: "escape" }] },
    },
  },
});
