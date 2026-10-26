import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

/**
 * Quarantine's behaviour, against an isolated catalog: this file marks a lesson
 * (Cells) quarantined in its own module graph, in the lesson and in the id list the generated tests read.
 */
vi.mock("./catalog/studyCells", async (original) => {
  const { studyCells } = await original<typeof import("./catalog/studyCells")>();
  return { studyCells: { ...studyCells, quarantined: true } };
});
vi.mock("./catalog/ids", async (original) => {
  const { tutorialEntries } = await original<typeof import("./catalog/ids")>();
  return {
    tutorialEntries: tutorialEntries.map((entry) =>
      entry.id === "study-cells" ? { ...entry, quarantined: true } : entry,
    ),
  };
});

const { allTutorials, findTutorial, tutorials } = await import("./catalog");
const { tutorialMetadata } = await import("./metadata");
const { nextTutorial, readTutorials, savedProgress, writeTutorials } = await import("./progress");
const { TutorialApp } = await import("./TutorialApp");
const { TutorialsView } = await import("./TutorialsView");

afterEach(() => vi.unstubAllGlobals());

it("a quarantined fixture stays hidden from cards, search, suggestions and deep links, preserving its progress", () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  const quarantined = allTutorials.filter((t) => t.quarantined);
  expect(quarantined.map((t) => t.id)).toEqual(["study-cells"]);
  const progress = Object.fromEntries(quarantined.map((t) => [t.id, { version: t.version, step: 1, completed: true }]));
  writeTutorials(() => ({ progress }));
  const cards = renderToStaticMarkup(<TutorialsView />);
  // The same lesson's track still has published lessons, whose cards render around the hidden one.
  expect(cards).toContain('data-testid="tutorial-card-study-rag"');
  for (const lesson of quarantined) {
    expect(tutorials).not.toContain(lesson);
    expect(cards).not.toContain(`data-testid="tutorial-card-${lesson.id}"`);
    expect(tutorialMetadata.some((t) => t.id === lesson.id)).toBe(false);
    expect(findTutorial(lesson.id)).toBeUndefined();
    const unavailable = renderToStaticMarkup(<TutorialApp id={lesson.id} />);
    expect(unavailable).toContain('data-phase="unknown"');
    expect(unavailable).not.toContain('data-testid="tutorial-start"');
    expect(savedProgress(lesson)).toBeUndefined();
    for (const current of tutorials) expect(nextTutorial(current, [lesson])).toBeUndefined();
  }
  expect(readTutorials().progress).toEqual(progress);
});
