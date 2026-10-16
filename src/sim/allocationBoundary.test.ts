import { expect, it, vi } from "vitest";
vi.mock("react", () => {
  throw new Error("Headless allocation must not load React");
});
import { validateAllocationActions } from "./allocation";

it("keeps allocation preflight independent of React", () => {
  expect(() =>
    validateAllocationActions([{ id: "n", rawProps: {} }], [{ node: "n", props: { replicas: 2 } }], 1),
  ).not.toThrow();
});
