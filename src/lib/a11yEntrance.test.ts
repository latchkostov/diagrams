import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Page } from "@playwright/test";
import { expectNoViolations } from "../../tests/e2e/a11y-helpers";

const { analyze } = vi.hoisted(() => ({ analyze: vi.fn() }));
vi.mock("@playwright/test", async () => ({ expect: (await import("vitest")).expect }));
vi.mock("@axe-core/playwright", () => ({
  default: class {
    withTags() {
      return this;
    }
    include() {
      return this;
    }
    analyze = analyze;
  },
}));

beforeEach(() => analyze.mockResolvedValue({ violations: [] }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function harness(names: string[]) {
  let finish!: () => void;
  let cancel!: () => void;
  const finished = new Promise<void>((resolve, reject) => {
    finish = resolve;
    cancel = () => reject(new Error("Animation cancelled"));
  });
  class TestAnimation {
    constructor(public animationName: string) {}
    finished = finished;
  }
  vi.stubGlobal("CSSAnimation", TestAnimation);
  vi.stubGlobal("document", { getAnimations: () => names.map((name) => new TestAnimation(name)) });
  const page = { evaluate: (fn: () => unknown) => fn() } as unknown as Page;
  return { page, finish, cancel };
}

it.each(["view-in", "ix-fade", "ix-rise"])("does not start an accessibility scan while %s is held", async (name) => {
  const h = harness([name]);
  const scan = expectNoViolations(h.page, "tutorials-view");
  // Drain the awaited promise chain before checking that the held entrance still blocks the scan.
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(analyze).not.toHaveBeenCalled();
  h.finish();
  await scan;
  expect(analyze).toHaveBeenCalledOnce();
});

it("continues after an entrance is cancelled by a view replacement", async () => {
  const h = harness(["view-in"]);
  const scan = expectNoViolations(h.page);
  h.cancel();
  await scan;
  expect(analyze).toHaveBeenCalledOnce();
});

it("does not wait for unrelated perpetual animations", async () => {
  const h = harness(["tutorial-pulse", "live-particles"]);
  await expectNoViolations(h.page);
  expect(analyze).toHaveBeenCalledOnce();
});

it("still reports every real settled accessibility violation", async () => {
  const h = harness([]);
  analyze.mockResolvedValue({
    violations: [{ id: "color-contrast", impact: "serious", help: "Contrast", nodes: [] }],
  });
  await expect(expectNoViolations(h.page)).rejects.toThrow("color-contrast");
});
