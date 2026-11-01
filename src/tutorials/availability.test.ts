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

it.each([
  { ai: false, rooms: false },
  { ai: false, rooms: true },
  { ai: true, rooms: false },
])("registers optional lessons only with their own build capability (AI=$ai, rooms=$rooms)", async ({ ai, rooms }) => {
  vi.doMock("../lib/deployment", () => ({ AI_TOOLS: ai }));
  vi.doMock("../lib/localOnly", () => ({ ROOMS: rooms }));
  const { allTutorials, findTutorial } = await import("./catalog");
  expect(allTutorials.some((lesson) => lesson.optional === "ai")).toBe(ai);
  expect(allTutorials.some((lesson) => lesson.optional === "collaboration")).toBe(rooms);
  expect(!!findTutorial("review-agent-changes")).toBe(ai);
  expect(!!findTutorial("work-together")).toBe(rooms);
  expect(findTutorial("export-for-audience")).toBeDefined();
});
