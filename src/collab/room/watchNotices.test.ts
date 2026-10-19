import { expect, it, vi } from "vitest";
import { watchNotices } from "./watchNotices";
import { notify } from "../../interop/ui/toast";

vi.mock("../../interop/ui/toast", () => ({ notify: vi.fn(), toast: { info: vi.fn() } }));

it("version mismatch wording works with either the host or follower on the newer page", () => {
  watchNotices.told("version", "Sam");
  expect(notify).toHaveBeenCalledWith(
    "Sam is on a different version of Live Diagrams. Reload both pages to watch together.",
    { kind: "error" },
  );
});
