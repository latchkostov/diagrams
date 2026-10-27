export type ToastContact = "pointer" | "focus" | "press" | "opener";
export type State = { value: "idle" | "engaged"; pointer: boolean; focus: boolean; press: boolean; opener: boolean };
export type Event = { type: "contact"; contact: ToastContact; active: boolean } | { type: "reset" };
const idle: State = { value: "idle", pointer: false, focus: false, press: false, opener: false };

/** Independent contacts: leaving with a button held or focus inside must keep the toast still. */
export function toastEngagement(state: State, event: Event): State {
  if (event.type === "reset") return idle;
  const next = { ...state, [event.contact]: event.active };
  next.value = next.pointer || next.focus || next.press || next.opener ? "engaged" : "idle";
  return next;
}

export function newContact() {
  let state = idle;
  return {
    get state() {
      return state;
    },
    send(event: Event) {
      state = toastEngagement(state, event);
    },
  };
}
