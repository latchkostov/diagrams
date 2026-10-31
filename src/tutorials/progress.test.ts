import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tutorials } from "./catalog";
import {
  earnedSeals,
  progressUndo,
  readTutorials,
  recordSeals,
  resetProgress,
  restoreProgress,
  savedProgress,
  subscribeTutorials,
  tutorialsSnapshot,
  saveProgress,
  writeTutorials,
  type StoredTutorials,
} from "./progress";
import { chapterSeals, seals } from "./seals";

beforeEach(() => {
  vi.stubGlobal("window", new EventTarget());
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const first = tutorials.find((lesson) => lesson.track === "basics")!;
const completed = (list = tutorials): StoredTutorials => ({
  highlights: false,
  progress: Object.fromEntries(
    list.map((lesson) => [lesson.id, { version: lesson.version, step: 0, completed: true }]),
  ),
});

it("dates the first finish, preserves it across replay and a new version", () => {
  vi.spyOn(Date, "now").mockReturnValue(1000);
  saveProgress(first, 1, false);
  expect(savedProgress(first)?.completedAt).toBeUndefined();
  saveProgress(first, 2, true);
  vi.mocked(Date.now).mockReturnValue(2000);
  saveProgress(first, 0, false);
  saveProgress(first, 2, true);
  expect(savedProgress(first)).toMatchObject({ completed: true, completedAt: 1000 });
  const newer = { ...first, version: first.version + 1 };
  expect(savedProgress(newer)).toBeUndefined();
  saveProgress(newer, 0, false);
  expect(savedProgress(newer)).toMatchObject({ completed: false, completedAt: 1000 });
  saveProgress(newer, 2, true);
  expect(savedProgress(newer)?.completedAt).toBe(1000);
});

it("reads the old stored shape and never invents completion dates for old finishes", () => {
  const old = completed([first]);
  writeTutorials(() => old);
  expect(readTutorials()).toEqual(old);
  expect(savedProgress(first)).toEqual(old.progress![first.id]);
  saveProgress(first, 0, false);
  saveProgress(first, 2, true);
  expect(savedProgress(first)?.completedAt).toBeUndefined();
});

it("records seals at finish, and never revokes or redates them on version changes", () => {
  vi.spyOn(Date, "now").mockReturnValue(1000);
  const chapter = tutorials.filter((lesson) => lesson.track === "basics");
  for (const lesson of chapter) saveProgress(lesson, 0, true);
  expect(readTutorials().marks).toEqual({ "chapter-basics": 1000 });
  vi.mocked(Date.now).mockReturnValue(2000);
  saveProgress({ ...first, version: first.version + 1 }, 0, false);
  expect(readTutorials().marks).toEqual({ "chapter-basics": 1000 });
  expect(earnedSeals(readTutorials(), tutorials)).toEqual(["chapter-basics"]);
  expect(recordSeals(readTutorials(), tutorials, 3000).marks).toEqual({ "chapter-basics": 1000 });
});

describe("pure seal rules", () => {
  it("has exactly the six stable chapter ids and the whole syllabus, with no first-lesson award", () => {
    expect(seals.map((seal) => seal.id)).toEqual([
      "chapter-basics",
      "chapter-blocks",
      "chapter-simulation",
      "chapter-waiting",
      "chapter-resilience",
      "chapter-studies",
      "whole-syllabus",
    ]);
    expect(earnedSeals({}, tutorials)).toEqual([]);
    expect(earnedSeals(completed([first]), tutorials)).toEqual([]);
    expect(earnedSeals(completed(), tutorials)).toEqual(seals.map((seal) => seal.id));
  });
  it("requires all published current versions, never empty or quarantined lessons", () => {
    const snapshot = completed();
    const before = JSON.stringify(snapshot);
    expect(
      earnedSeals(
        snapshot,
        tutorials.map((lesson) => (lesson.id === first.id ? { ...lesson, version: lesson.version + 1 } : lesson)),
      ),
    ).not.toContain("chapter-basics");
    expect(earnedSeals(snapshot, [])).toEqual([]);
    expect(earnedSeals(snapshot, [{ ...first, quarantined: true }])).toEqual([]);
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});

for (const scope of [{ all: true }, { track: "basics" }, { lesson: first.id }] as const) {
  it(`resets ${JSON.stringify(scope)} and restores the exact in-memory snapshot`, () => {
    const snapshot = recordSeals(completed(), tutorials, 1000);
    snapshot.progress![first.id] = { version: first.version, step: 1, completed: false, completedAt: 500 };
    writeTutorials(() => snapshot);
    const previous = resetProgress(scope);
    expect(previous).toEqual(snapshot);
    const result = readTutorials();
    expect(result.highlights).toBe(false);
    expect(result.progress?.[first.id]).toBeUndefined();
    expect(result.marks?.["chapter-basics"]).toBeUndefined();
    expect(result.marks?.["whole-syllabus"]).toBeUndefined();
    if ("all" in scope) {
      expect(result.progress).toEqual({});
      expect(result.marks).toEqual({});
    } else {
      for (const seal of chapterSeals.filter((seal) => seal.track !== "basics"))
        expect(result.marks?.[seal.id]).toBe(1000);
      const sameChapter = tutorials.filter((lesson) => lesson.track === "basics" && lesson.id !== first.id);
      for (const lesson of sameChapter) expect(!!result.progress?.[lesson.id]).toBe("lesson" in scope);
    }
    restoreProgress(previous);
    expect(readTutorials()).toEqual(snapshot);
    expect(previous).toEqual(snapshot);
  });
}

it("scoped resets preserve every unselected progress entry including versions, steps and dates", () => {
  const snapshot = completed();
  for (const [index, lesson] of tutorials.entries()) {
    snapshot.progress![lesson.id] = {
      version: lesson.version + (index % 2),
      step: index % lesson.steps.length,
      completed: index % 2 === 0,
      completedAt: 1000 + index,
    };
  }
  for (const scope of [{ track: "basics" }, { lesson: first.id }] as const) {
    writeTutorials(() => snapshot);
    resetProgress(scope);
    const survivors = tutorials.filter((lesson) =>
      "track" in scope ? lesson.track !== scope.track : lesson.id !== scope.lesson,
    );
    expect(readTutorials().progress).toEqual(
      Object.fromEntries(survivors.map((lesson) => [lesson.id, snapshot.progress![lesson.id]])),
    );
  }
});

it("keeps reset Undo available across subscriptions and unchanged writes, and consumes it once", () => {
  const snapshot = completed([first]);
  writeTutorials(() => snapshot);
  const undo = progressUndo(resetProgress({ all: true }));
  try {
    const unsubscribe = subscribeTutorials(vi.fn());
    unsubscribe();
    writeTutorials((s) => s);
    expect(undo.restore()).toBe(true);
    expect(readTutorials()).toEqual(snapshot);
    expect(undo.restore()).toBe(false);
  } finally {
    undo.dispose();
  }
});

for (const change of ["save", "highlights", "storage", "clear", "pending storage"] as const) {
  it(`invalidates reset Undo after ${change} without overwriting newer storage`, () => {
    writeTutorials(() => completed([first]));
    const undo = progressUndo(resetProgress({ track: "basics" }));
    const afterReset = tutorialsSnapshot();
    try {
      if (change === "save")
        saveProgress(
          tutorials.find((lesson) => lesson.track !== "basics")!,
          1,
          true,
        );
      else if (change === "highlights") writeTutorials((s) => ({ ...s, highlights: true }));
      else {
        localStorage.setItem("diagrams.tutorials.v1", JSON.stringify({ progress: {}, highlights: true }));
        if (change !== "pending storage")
          window.dispatchEvent(
            Object.assign(new Event("storage"), { key: change === "clear" ? null : "diagrams.tutorials.v1" }),
          );
      }
      const newer = tutorialsSnapshot();
      expect(undo.restore()).toBe(false);
      expect(tutorialsSnapshot()).toBe(newer);
      // Invalidated recovery stays invalid even if a later save puts the reset state back.
      localStorage.setItem("diagrams.tutorials.v1", afterReset);
      expect(undo.restore()).toBe(false);
    } finally {
      undo.dispose();
    }
  });
}

for (const change of ["local", "storage"] as const) {
  it(`never revives Undo after a ${change} change returns to the post-reset snapshot`, () => {
    writeTutorials(() => completed([first]));
    const undo = progressUndo(resetProgress({ all: true }));
    const afterReset = readTutorials();
    try {
      if (change === "local") writeTutorials((s) => ({ ...s, highlights: true }));
      else {
        localStorage.setItem("diagrams.tutorials.v1", JSON.stringify({ highlights: true }));
        window.dispatchEvent(Object.assign(new Event("storage"), { key: "diagrams.tutorials.v1" }));
      }
      writeTutorials(() => afterReset);
      expect(undo.restore()).toBe(false);
      expect(readTutorials()).toEqual(afterReset);
    } finally {
      undo.dispose();
    }
  });
}

it("publishes local changes and Undo to a remounted hub subscription", () => {
  const events = new Map<string, (event: StorageEvent) => void>();
  vi.stubGlobal("window", {
    addEventListener: (name: string, fn: (event: StorageEvent) => void) => events.set(name, fn),
    removeEventListener: (name: string) => events.delete(name),
  });
  const listener = vi.fn();
  const unsubscribe = subscribeTutorials(listener);
  try {
    const initial = tutorialsSnapshot();
    expect(tutorialsSnapshot()).toBe(initial);
    writeTutorials(() => completed([first]));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(tutorialsSnapshot()).not.toBe(initial);
    const previous = resetProgress({ all: true });
    expect(listener).toHaveBeenCalledTimes(2);
    restoreProgress(previous);
    expect(listener).toHaveBeenCalledTimes(3);
    expect(savedProgress(first)?.completed).toBe(true);
    events.get("storage")?.({ key: "unrelated" } as StorageEvent);
    expect(listener).toHaveBeenCalledTimes(3);
    events.get("storage")?.({ key: "diagrams.tutorials.v1" } as StorageEvent);
    expect(listener).toHaveBeenCalledTimes(4);
  } finally {
    unsubscribe();
  }
  writeTutorials(() => ({}));
  expect(listener).toHaveBeenCalledTimes(4);
});
