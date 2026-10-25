import { expect, it } from "vitest";
import { machinePaths, machineStep } from "../lib/machine";
import { messagePickerMode } from "./messagePickerMode";

it("picker paths alternate choosing and adding, rejecting keys outside their mode", () => {
  for (const { state, events } of machinePaths(messagePickerMode, { maxDepth: 4 })) {
    expect(state.value).toBe(events.length % 2 ? "adding" : "choosing");
    const rejected: (typeof messagePickerMode.events)[number] = {
      type: state.value === "adding" ? "add" : "finish",
    };
    expect(machineStep(messagePickerMode, state, rejected).accepted).toBe(false);
  }
});
