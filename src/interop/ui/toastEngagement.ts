import { defineMachine } from "../../lib/machine";

export type ToastContact = "pointer" | "focus" | "press" | "opener";
type State = { value: "idle" | "engaged"; pointer: boolean; focus: boolean; press: boolean; opener: boolean };
type Event = { type: "contact"; contact: ToastContact; active: boolean } | { type: "reset" };
const idle: State = { value: "idle", pointer: false, focus: false, press: false, opener: false };
const contacted = (state: State, event: Event & { type: "contact" }): State => ({
  ...state,
  [event.contact]: event.active,
});
const engaged = (state: State) => state.pointer || state.focus || state.press || state.opener;

/** Independent contacts: leaving with a button held or focus inside must keep the toast still. */
export const toastEngagement = defineMachine<State, Event>({
  initial: idle,
  states: ["idle", "engaged"],
  on: {
    "*": {
      contact: [
        { target: "engaged", guard: (s, e) => engaged(contacted(s, e)), reduce: contacted },
        { target: "idle", reduce: contacted },
      ],
      reset: { target: "idle", reduce: () => idle },
    },
  },
  events: [
    ...(["pointer", "focus", "press", "opener"] as const).flatMap((contact) =>
      [true, false].map((active): Event => ({ type: "contact", contact, active })),
    ),
    { type: "reset" },
  ],
});
