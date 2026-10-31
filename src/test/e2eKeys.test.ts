import { expect, it } from "vitest";
import { tutorialKey } from "../../scripts/e2e-keys";

it("tutorial text recipes reach the document boundary with native macOS caret keys", () => {
  expect(tutorialKey("ControlOrMeta+End", "darwin")).toBe("Meta+ArrowDown");
  expect(tutorialKey("ControlOrMeta+Home", "darwin")).toBe("Meta+ArrowUp");
  for (const platform of ["win32", "linux"] as const) {
    expect(tutorialKey("ControlOrMeta+End", platform)).toBe("ControlOrMeta+End");
    expect(tutorialKey("ControlOrMeta+Home", platform)).toBe("ControlOrMeta+Home");
  }
  expect(tutorialKey("End", "darwin")).toBe("End");
  expect(tutorialKey("ArrowDown", "darwin")).toBe("ArrowDown");
});
