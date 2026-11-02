import { expect, it } from "vitest";
import { createMachine, machinePaths } from "../../lib/machine";
import { areaDialogMachine } from "./areaDialogMachine";

it("area acceptance retains selection focus; cancellation alone returns to the opener across every short path", () => {
  for (const path of machinePaths(areaDialogMachine, { maxDepth: 4 })) {
    const m = createMachine(areaDialogMachine);
    const commands = path.events.flatMap((event) => m.send(event).commands);
    if (path.events[0]?.type === "apply" && path.events[0].accepted) expect(commands).toEqual([]);
  }
  const m = createMachine(areaDialogMachine);
  m.send({ type: "apply", accepted: false });
  expect(m.state.value).toBe("open");
  m.send({ type: "cancel" });
  const opener = {};
  expect(m.send({ type: "dispose", opener }).commands).toEqual([{ type: "restore", opener, reason: "escape" }]);
  expect(m.send({ type: "dispose", opener }).commands).toEqual([]);
});
