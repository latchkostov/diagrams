import { expect, it } from "vitest";
import { newContact, toastEngagement, type Event, type State } from "./toastEngagement";

it("stays engaged on every representative path while any contact remains", () => {
  const events: Event[] = [
    ...(["pointer", "focus", "press", "opener"] as const).flatMap((contact) =>
      [true, false].map((active): Event => ({ type: "contact", contact, active })),
    ),
    { type: "reset" },
  ];
  function visit(state: State, depth: number) {
    expect(state.value === "engaged").toBe(state.pointer || state.focus || state.press || state.opener);
    if (depth) for (const event of events) visit(toastEngagement(state, event), depth - 1);
  }
  visit(newContact().state, 4);
});
