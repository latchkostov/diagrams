import { expect, it } from "vitest";
import { machinePaths } from "../../lib/machine";
import { toastEngagement } from "./toastEngagement";

it("stays engaged on every representative path while any contact remains", () => {
  const paths = machinePaths(toastEngagement, { maxDepth: 4 });
  expect(new Set(paths.map(({ state }) => state.value))).toEqual(new Set(["idle", "engaged"]));
  for (const { state } of paths) {
    expect(state.value === "engaged").toBe(state.pointer || state.focus || state.press);
  }
});
