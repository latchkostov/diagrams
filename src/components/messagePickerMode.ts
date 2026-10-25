import { defineMachine } from "../lib/machine";

export const messagePickerMode = defineMachine<{ value: "choosing" | "adding" }, { type: "add" | "finish" }>({
  initial: { value: "choosing" },
  states: ["choosing", "adding"],
  events: [{ type: "add" }, { type: "finish" }],
  on: {
    choosing: { add: { target: "adding" } },
    adding: { finish: { target: "choosing" } },
  },
});
