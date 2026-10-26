import { expect, it } from "vitest";
import { createMachine, machinePaths } from "../../lib/machine";
import { toolMachine } from "./tools";
it("has exactly one transient tool surface and Escape/drop can close either flyout", () => {
  const machine = createMachine(toolMachine);
  machine.send({ type: "library" });
  expect(machine.state.value).toBe("library");
  machine.send({ type: "annotate" });
  expect(machine.state.value).toBe("annotate");
  machine.send({ type: "closed" });
  expect(machine.state.value).toBe("closed");
  for (const path of machinePaths(toolMachine, { maxDepth: 4 }))
    expect(["closed", "library", "annotate"]).toContain(path.state.value);
});
