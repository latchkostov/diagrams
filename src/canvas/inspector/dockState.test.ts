import { expect, it } from "vitest";
import { createMachine, machinePaths } from "../../lib/machine";
import { dockMachine } from "./dockState";
it("starts closed and Checks returns to the preceding tab or closes", () => {
  for (const previous of ["closed", "properties", "ai"] as const) {
    const machine = createMachine(dockMachine);
    if (previous !== "closed") machine.send({ type: previous });
    machine.send({ type: "checks" });
    machine.send({ type: "checks" });
    machine.send({ type: "back" });
    expect(machine.state.value).toBe(previous);
  }
});
it("remembers the tab on close and keeps only one active surface on every path", () => {
  const machine = createMachine(dockMachine);
  machine.send({ type: "ai" });
  machine.send({ type: "close" });
  expect(machine.state).toMatchObject({ value: "closed", last: "ai" });
  for (const path of machinePaths(dockMachine, { maxDepth: 4 }))
    expect(["closed", "properties", "checks", "ai"]).toContain(path.state.value);
});
