import { afterEach, expect, it, vi } from "vitest";
afterEach(() => {
  vi.doUnmock("../lib/deployment");
  vi.doUnmock("../lib/localOnly");
  vi.resetModules();
});

it("keeps core lessons available when both optional capabilities are compiled off", async () => {
  vi.doMock("../lib/deployment", () => ({ AI_TOOLS: false }));
  vi.doMock("../lib/localOnly", () => ({ ROOMS: false }));
  const { tutorialAvailable } = await import("./availability");
  expect(tutorialAvailable({})).toBe(true);
  expect(tutorialAvailable({ optional: "ai" })).toBe(false);
  expect(tutorialAvailable({ optional: "collaboration" })).toBe(false);
});
