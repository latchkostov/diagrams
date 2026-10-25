import { safeStorage } from "../lib/storage";
import type { Tutorial } from "./types";

/** This browser's tutorial progress and the Highlights switch. "Clear everything" forgets it (a `diagrams.` key). */
const STORE = "diagrams.tutorials.v1";
export interface StoredTutorials {
  highlights?: boolean;
  progress?: Record<string, { version: number; step: number; completed: boolean }>;
}

export function readTutorials(): StoredTutorials {
  try {
    const parsed = JSON.parse(safeStorage.getItem(STORE) ?? "{}") as unknown;
    return parsed && typeof parsed === "object" ? (parsed as StoredTutorials) : {};
  } catch {
    return {};
  }
}

export const writeTutorials = (edit: (s: StoredTutorials) => StoredTutorials) =>
  void safeStorage.setItem(STORE, JSON.stringify(edit(readTutorials())));

/** Completed, or the step to continue from; progress saved for another version of the tutorial doesn't count. */
export function savedProgress(t: Pick<Tutorial, "id" | "version" | "quarantined">) {
  if (t.quarantined) return undefined;
  const p = readTutorials().progress?.[t.id];
  return p && p.version === t.version ? p : undefined;
}

/** First unfinished lesson in this track, in catalog order. */
export function nextTutorial(current: Tutorial, catalog: readonly Tutorial[]): Tutorial | undefined {
  return catalog.find(
    (t) => !t.quarantined && t.id !== current.id && t.track === current.track && !savedProgress(t)?.completed,
  );
}

/** Completion survives a restart only while the tutorial's meaning (version) is unchanged. */
export function saveProgress(tutorial: Pick<Tutorial, "id" | "version">, step: number, completed: boolean) {
  writeTutorials((s) => ({
    ...s,
    progress: {
      ...s.progress,
      [tutorial.id]: {
        version: tutorial.version,
        step,
        completed:
          completed || (s.progress?.[tutorial.id]?.version === tutorial.version && !!s.progress[tutorial.id].completed),
      },
    },
  }));
}
