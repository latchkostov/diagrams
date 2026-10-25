import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { allTutorials, findTutorial, tutorials } from "./catalog";
import { tutorialMetadata } from "./metadata";
import { nextTutorial, readTutorials, savedProgress, writeTutorials } from "./progress";
import { TutorialApp } from "./TutorialApp";
import { TutorialsView } from "./TutorialsView";

afterEach(() => vi.unstubAllGlobals());

it("hides quarantined lessons from cards, search, suggestions and deep links while retaining saved progress", () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  const quarantined = allTutorials.filter((t) => t.quarantined);
  expect(quarantined.map((t) => t.id)).toEqual([
    "insert-on-edge",
    "arrange",
    "dependencies-2",
    "backlog-lag",
    "scale-to-zero",
    "capacity",
    "trace-slowmo",
    "saved-simulations",
    "rate-limit",
  ]);
  const progress = Object.fromEntries(quarantined.map((t) => [t.id, { version: t.version, step: 1, completed: true }]));
  writeTutorials(() => ({ progress }));
  const cards = renderToStaticMarkup(<TutorialsView />);
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
