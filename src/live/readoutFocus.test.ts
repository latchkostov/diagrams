import { expect, it } from "vitest";
import { createMachine, machinePaths, machineStep } from "../lib/machine";
import { readoutFocusMachine } from "./readoutFocus";

it("covers focus ownership paths and keeps cancellation terminal", () => {
  const paths = machinePaths(readoutFocusMachine, { maxDepth: 4 });
  expect(new Set(paths.map((p) => p.state.value))).toEqual(new Set(readoutFocusMachine.states));
  for (const { state } of paths) {
    for (const event of readoutFocusMachine.events) {
      const next = machineStep(readoutFocusMachine, state, event);
      if (state.value === "cancelled") expect(next.state).toBe(state);
      if (next.commands.length) {
        expect(event.type).toBe("claim");
        if (event.type !== "claim") throw new Error("Only a claim can move focus");
        expect(event.eligible).toBe(true);
        expect(
          (state.value === "unclaimed" && event.at === "opener" && event.pinned) ||
            (state.value === "held" && event.at === "vacant"),
        ).toBe(true);
        expect(next.state.value).toBe("transferred");
      }
    }
  }
});

it("retains a focused summary section's ownership across its pinned replacement", () => {
  const machine = createMachine(readoutFocusMachine);
  machine.send({ type: "open", at: "readout", pinned: true });
  machine.send({ type: "focus", at: "vacant" });
  expect(machine.state.value).toBe("held");
  expect(machine.send({ type: "claim", at: "vacant", pinned: true, eligible: true }).commands).toEqual(["focus"]);
  expect(machine.send({ type: "claim", at: "vacant", pinned: true, eligible: true }).commands).toEqual([]);
});

it("does not inherit a pinned section's focus when traversal releases the card", () => {
  const machine = createMachine(readoutFocusMachine);
  machine.send({ type: "open", at: "readout", pinned: false });
  expect(machine.state.value).toBe("unclaimed");
  expect(machine.send({ type: "claim", at: "vacant", pinned: false, eligible: true }).commands).toEqual([]);
});

it.each(["opener", "other"] as const)("cancels a loading stop's claim when focus leaves for %s", (at) => {
  const machine = createMachine(readoutFocusMachine);
  expect(machine.send({ type: "claim", at: "opener", pinned: true, eligible: true }).commands).toEqual(["focus"]);
  machine.send({ type: "focus", at: "readout" });
  machine.send({ type: "focus", at });
  expect(machine.state.value).toBe("cancelled");
  machine.send({ type: "focus", at: "readout" });
  expect(machine.send({ type: "claim", at: "opener", pinned: true, eligible: true }).commands).toEqual([]);
  expect(machine.send({ type: "claim", at: "vacant", pinned: true, eligible: true }).commands).toEqual([]);
});

it("hands a cold loading stop to its card only while it still owns focus", () => {
  const machine = createMachine(readoutFocusMachine);
  machine.send({ type: "focus", at: "readout" });
  expect(machine.send({ type: "claim", at: "vacant", pinned: false, eligible: false }).commands).toEqual([]);
  expect(machine.send({ type: "claim", at: "vacant", pinned: false, eligible: true }).commands).toEqual(["focus"]);
});
