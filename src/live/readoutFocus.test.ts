import { expect, it } from "vitest";
import { createMachine, machinePaths, machineStep } from "../lib/machine";
import { readoutFocusMachine, type ReadoutFocusAt } from "./readoutFocus";

// Independently enumerate every payload: 8 opens + 4 focus events + 16 claims, in all four states.
// Each vector lists the expected state in unclaimed / held / cancelled / transferred order.
const states = ["unclaimed", "held", "cancelled", "transferred"] as const;
const places: ReadoutFocusAt[] = ["readout", "opener", "vacant", "other"];
type State = (typeof states)[number];
type Event = (typeof readoutFocusMachine.events)[number];
type Outcomes = readonly [State, State, State, State];
type Cell = { event: Event; next: Outcomes; focusFrom?: State };
const unchanged = states;
const cells: Cell[] = [];
for (const at of places) {
  for (const pinned of [false, true]) {
    cells.push({
      event: { type: "open", at, pinned },
      next: at === "readout" && pinned ? ["held", "held", "cancelled", "transferred"] : unchanged,
    });
  }
  const focusRows: Record<ReadoutFocusAt, Outcomes> = {
    readout: ["held", "held", "held", "held"],
    opener: ["unclaimed", "cancelled", "cancelled", "cancelled"],
    vacant: ["cancelled", "held", "cancelled", "transferred"],
    other: ["cancelled", "cancelled", "cancelled", "cancelled"],
  };
  cells.push({ event: { type: "focus", at }, next: focusRows[at] });
  for (const pinned of [false, true]) {
    for (const eligible of [false, true]) {
      const claimRows: Record<ReadoutFocusAt, Outcomes> = {
        readout: unchanged,
        opener: pinned ? ["transferred", "held", "cancelled", "transferred"] : unchanged,
        vacant: ["unclaimed", "transferred", "cancelled", "transferred"],
        other: unchanged,
      };
      cells.push({
        event: { type: "claim", at, pinned, eligible },
        next: eligible ? claimRows[at] : unchanged,
        focusFrom: eligible
          ? at === "vacant"
            ? "held"
            : at === "opener" && pinned
              ? "unclaimed"
              : undefined
          : undefined,
      });
    }
  }
}
for (const [index, value] of states.entries()) {
  it.each(cells.map((cell) => ({ ...cell, label: JSON.stringify(cell.event) })))(
    `${value} × $label matches the transition table`,
    ({ event, next, focusFrom }) => {
      const result = machineStep(readoutFocusMachine, { value }, event);
      expect(result.state.value).toBe(next[index]);
      expect(result.commands).toEqual(focusFrom === value ? ["focus"] : []);
    },
  );
}

it("covers focus ownership paths and only transfers an eligible claim", () => {
  const paths = machinePaths(readoutFocusMachine, { maxDepth: 4 });
  expect(new Set(paths.map((p) => p.state.value))).toEqual(new Set(readoutFocusMachine.states));
  for (const { state } of paths) {
    for (const event of readoutFocusMachine.events) {
      const next = machineStep(readoutFocusMachine, state, event);
      if (state.value === "cancelled" && !(event.type === "focus" && event.at === "readout"))
        expect(next.state).toBe(state);
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
  expect(machine.send({ type: "claim", at: "opener", pinned: true, eligible: true }).commands).toEqual([]);
  expect(machine.send({ type: "claim", at: "vacant", pinned: true, eligible: true }).commands).toEqual([]);
  machine.send({ type: "focus", at: "readout" });
  expect(machine.state.value).toBe("held");
  expect(machine.send({ type: "claim", at: "opener", pinned: true, eligible: true }).commands).toEqual([]);
  expect(machine.send({ type: "claim", at: "vacant", pinned: true, eligible: false }).commands).toEqual([]);
  expect(machine.send({ type: "claim", at: "vacant", pinned: true, eligible: true }).commands).toEqual(["focus"]);
});

it("hands a cold loading stop to its card only while it still owns focus", () => {
  const machine = createMachine(readoutFocusMachine);
  machine.send({ type: "focus", at: "readout" });
  expect(machine.send({ type: "claim", at: "vacant", pinned: false, eligible: false }).commands).toEqual([]);
  expect(machine.send({ type: "claim", at: "vacant", pinned: false, eligible: true }).commands).toEqual(["focus"]);
});
