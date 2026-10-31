import { safeStorage } from "../lib/storage";
import { tracks, tutorials } from "./catalog";
import { chapterSeals, earnedSeals, lessonProgress, type SealLesson } from "./seals";
import type { TrackId, Tutorial } from "./types";
export { earnedSeals } from "./seals";

/** Optional additions keep older builds compatible with this browser-only key. */
const STORE = "diagrams.tutorials.v1";
export interface StoredTutorials {
  highlights?: boolean;
  progress?: Record<string, { version: number; step: number; completed: boolean; completedAt?: number }>;
  marks?: Record<string, number>;
}
export type ResetScope = { all: true } | { track: TrackId } | { lesson: string };

const listeners = new Set<() => void>();
/** A stable primitive snapshot also lets Undo refresh a hub remounted after a navigation. */
export const tutorialsSnapshot = () => safeStorage.getItem(STORE) ?? "{}";
export function subscribeTutorials(listener: () => void): () => void {
  listeners.add(listener);
  const changed = (event: StorageEvent) => {
    if (event.key === STORE || event.key === null) listener();
  };
  window.addEventListener("storage", changed);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", changed);
  };
}

export function readTutorials(raw?: string): StoredTutorials {
  try {
    const parsed = JSON.parse(raw ?? tutorialsSnapshot()) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as StoredTutorials) : {};
  } catch {
    return {};
  }
}

export function writeTutorials(edit: (s: StoredTutorials) => StoredTutorials): void {
  safeStorage.setItem(STORE, JSON.stringify(edit(readTutorials())));
  listeners.forEach((listener) => listener());
}

/** Progress saved for another version does not count toward lessons. Seals keep their dates. */
export function savedProgress(t: Pick<Tutorial, "id" | "version" | "quarantined">) {
  return lessonProgress(readTutorials(), { ...t, track: "basics" });
}

/** Follow chapter order, then wrap to any unfinished lessons left earlier in the syllabus. */
export function nextTutorial(
  current: Tutorial,
  catalog: readonly Tutorial[],
  progress = readTutorials(),
): Tutorial | undefined {
  const ordered = tracks.flatMap((track) => catalog.filter((lesson) => lesson.track === track.id));
  const index = ordered.findIndex((lesson) => lesson.id === current.id);
  return [...ordered.slice(index + 1), ...ordered.slice(0, index)].find(
    (lesson) => !lesson.quarantined && lesson.id !== current.id && !lessonProgress(progress, lesson)?.completed,
  );
}

/** Backfill awards for old completed shapes without inventing lesson completion dates. */
export function recordSeals(
  snapshot: StoredTutorials,
  catalog: readonly SealLesson[],
  now = Date.now(),
): StoredTutorials {
  const marks = { ...snapshot.marks };
  for (const id of earnedSeals(snapshot, catalog)) marks[id] ??= now;
  return { ...snapshot, marks };
}

export function saveProgress(tutorial: Pick<Tutorial, "id" | "version">, step: number, completed: boolean) {
  writeTutorials((s) => {
    const previous = s.progress?.[tutorial.id];
    const finished = completed || (previous?.version === tutorial.version && !!previous.completed);
    // A legacy completed entry has no known date. Replaying it must not invent one.
    const completedAt = previous?.completedAt ?? (completed && !previous?.completed ? Date.now() : undefined);
    return recordSeals(
      {
        ...s,
        progress: {
          ...s.progress,
          [tutorial.id]: {
            version: tutorial.version,
            step,
            completed: finished,
            ...(completedAt === undefined ? {} : { completedAt }),
          },
        },
      },
      tutorials,
    );
  });
}

/** Intentional reset also forgets the affected chapter seal and the whole-syllabus seal. */
export function withoutProgress(
  snapshot: StoredTutorials,
  scope: ResetScope,
  catalog: readonly SealLesson[] = tutorials,
): StoredTutorials {
  if ("all" in scope) return { ...snapshot, progress: {}, marks: {} };
  const selected = catalog.filter((lesson) =>
    "track" in scope ? lesson.track === scope.track : lesson.id === scope.lesson,
  );
  const ids = new Set(selected.map((lesson) => lesson.id));
  const affectedTracks = new Set("track" in scope ? [scope.track] : selected.map((lesson) => lesson.track));
  const removedMarks = new Set<string>([
    "whole-syllabus",
    ...chapterSeals.filter((seal) => affectedTracks.has(seal.track)).map((seal) => seal.id),
  ]);
  return {
    ...snapshot,
    progress: Object.fromEntries(Object.entries(snapshot.progress ?? {}).filter(([id]) => !ids.has(id))),
    marks: Object.fromEntries(Object.entries(snapshot.marks ?? {}).filter(([id]) => !removedMarks.has(id))),
  };
}

export function resetProgress(scope: ResetScope): StoredTutorials {
  const previous = readTutorials();
  writeTutorials(() => withoutProgress(previous, scope));
  return previous;
}

/** Undo's snapshot stays in memory; no second persistent key is created. */
export function restoreProgress(snapshot: StoredTutorials): void {
  writeTutorials(() => snapshot);
}

/** Held by the toast, so navigation does not discard Undo or stop watching for newer saves. */
export function progressUndo(previous: StoredTutorials) {
  const expected = tutorialsSnapshot();
  let valid = true;
  const dispose = subscribeTutorials(() => {
    if (tutorialsSnapshot() !== expected) valid = false;
  });
  return {
    dispose,
    restore() {
      // Check storage too: another tab's write may precede delivery of its storage event.
      const canRestore = valid && tutorialsSnapshot() === expected;
      valid = false;
      if (!canRestore) return false;
      restoreProgress(previous);
      return true;
    },
  };
}
