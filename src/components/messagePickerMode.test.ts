import { expect, it } from "vitest";
import { machinePaths, machineStep } from "../lib/machine";
import { messagePickerMode } from "./messagePickerMode";

it("accepts add and finish through a complete picker cycle", () => {
  const added = machineStep(messagePickerMode, messagePickerMode.initial, { type: "add" } as const);
  expect(added.accepted).toBe(true);
  expect(added.state.value).toBe("adding");
  const finished = machineStep(messagePickerMode, added.state, { type: "finish" } as const);
  expect(finished.accepted).toBe(true);
  expect(finished.state.value).toBe("choosing");
});

it("picker paths alternate choosing and adding, rejecting keys outside their mode", () => {
  for (const { state, events } of machinePaths(messagePickerMode, { maxDepth: 4 })) {
    expect(state.value).toBe(events.length % 2 ? "adding" : "choosing");
    const rejected: (typeof messagePickerMode.events)[number] = {
      type: state.value === "adding" ? "add" : "finish",
    };
    expect(machineStep(messagePickerMode, state, rejected).accepted).toBe(false);
  }
});
