import { expect, it, vi } from "vitest";
import { createMachine, machinePaths } from "../../lib/machine";
import { ChecksStore } from "../checks/useChecks";
import { toolMachine, tools } from "./tools";
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

it.each(["library", "annotate"] as const)("connecting Live closes an open %s flyout", (surface) => {
  tools.open(surface);
  const disconnect = tools.connect({
    live: true,
    pinned: false,
    checks: new ChecksStore(),
    select: vi.fn(),
    shortcuts: vi.fn(),
  });
  try {
    expect(tools.get()).toBe("closed");
  } finally {
    disconnect();
  }
});
