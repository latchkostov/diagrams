import { expect, it, vi } from "vitest";
vi.mock("../interop/native", () => {
  throw new Error("The file adapter is unavailable in headless simulation");
});
import { resolveProps } from "./defaults";

it("headless admission validates policies without loading the native file adapter", () => {
  expect(
    resolveProps("sink", "API", { api: { maxInFlight: 1 } }, "generic.external-api", { revision: "p3" }).admission
      ?.invalid,
  ).toBeUndefined();
  expect(
    resolveProps("sink", "API", { api: { maxInFlight: -1 } }, "generic.external-api", { revision: "p3" }).admission
      ?.invalid,
  ).toBe(true);
});
