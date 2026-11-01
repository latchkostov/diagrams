// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { build, type Rollup } from "vite";
import { resolve } from "node:path";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
afterEach(() => {
  vi.doUnmock("../lib/deployment");
  vi.doUnmock("../lib/localOnly");
  vi.doUnmock("./BlueprintBoard");
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
  { ai: true, rooms: true },
])(
  "keeps optional identities with implementation only for enabled capabilities (AI=$ai, rooms=$rooms)",
  async ({ ai, rooms }) => {
    vi.doMock("../lib/deployment", () => ({ AI_TOOLS: ai }));
    vi.doMock("../lib/localOnly", () => ({ ROOMS: rooms }));
    const { allTutorials, findTutorial, tutorialCatalog } = await import("./catalog");
    const { tutorialMetadata } = await import("./metadata");
    const { lessonNumber } = await import("./handoff");
    expect(allTutorials.some((lesson) => lesson.optional === "ai")).toBe(ai);
    expect(allTutorials.some((lesson) => lesson.optional === "collaboration")).toBe(rooms);
    expect(tutorialCatalog.map((lesson) => lesson.id)).toEqual(tutorialMetadata.map((lesson) => lesson.id));
    for (const [id, enabled] of [
      ["review-agent-changes", ai],
      ["work-together", rooms],
    ] as const) {
      const lesson = findTutorial(id)!;
      expect(lesson).toBeDefined();
      expect(lessonNumber(lesson, tutorialCatalog)).toBe(id === "work-together" ? "7.3" : "7.4");
      if (enabled) {
        expect(lesson).not.toHaveProperty("unavailable");
        expect(lesson).toHaveProperty("start");
        expect(lesson).toHaveProperty("steps");
      } else {
        expect(Object.keys(lesson).sort()).toEqual(["id", "optional", "summary", "title", "track", "unavailable"]);
        expect(lesson.track).toBe("sharing");
        expect(lesson.title()).not.toBe("");
        expect(lesson.summary()).not.toBe("");
        expect("unavailable" in lesson && lesson.unavailable()).toContain("unavailable in this build");
      }
    }
    expect(findTutorial("export-for-audience")).toBeDefined();
  },
);

it("bundles unavailable stubs without prompt strings, lesson implementations or capability code", async () => {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      lib: { entry: resolve("src/tutorials/catalog/unavailable.ts").replaceAll("\\", "/"), formats: ["es"] },
      rollupOptions: { external: ["../../i18n"] },
    },
  });
  const chunks = (Array.isArray(result) ? result : [result])
    .flatMap((r) => (r as Rollup.RolldownOutput).output)
    .filter((output) => output.type === "chunk");
  expect(chunks).toHaveLength(1);
  const code = chunks.map((chunk) => chunk.code).join("\n");
  expect(code).toContain("work-together");
  expect(code).toContain("review-agent-changes");
  expect(code).not.toMatch(/prompt|Copy prompt|ai-reply|Status worker|Unreviewed worker|localPeer|agentFixture/i);
  expect(chunks.flatMap((chunk) => Object.keys(chunk.modules))).toEqual([
    resolve("src/tutorials/catalog/unavailable.ts").replaceAll("\\", "/"),
  ]);
});

it("keeps the next lesson number aligned with the hub when collaboration is compiled off", async () => {
  vi.doMock("../lib/deployment", () => ({ AI_TOOLS: true }));
  vi.doMock("../lib/localOnly", () => ({ ROOMS: false }));
  const { tutorials } = await import("./catalog");
  const { FinishHandoff } = await import("./FinishHandoff");
  const progress = {
    progress: Object.fromEntries(
      tutorials
        .filter((lesson) => !lesson.optional)
        .map((lesson) => [
          lesson.id,
          {
            version: lesson.version,
            step: 0,
            completed: true,
          },
        ]),
    ),
  };
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(() =>
      root.render(
        createElement(FinishHandoff, {
          tutorial: tutorials.find((lesson) => lesson.id === "export-for-audience")!,
          catalog: tutorials,
          before: {},
          progress,
        }),
      ),
    );
    const html = host.innerHTML;
    expect(html).toContain('data-testid="tutorial-next"');
    expect(html).toContain("Start 7.4");
    expect(html).toContain('data-testid="tutorial-handoff-lesson-number">7.4</span>');
    expect(html).not.toContain("Start 7.3");
  } finally {
    await act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
