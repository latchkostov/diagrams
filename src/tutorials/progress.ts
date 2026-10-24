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
export function savedProgress(t: Pick<Tutorial, "id" | "version">) {
  const p = readTutorials().progress?.[t.id];
  return p && p.version === t.version ? p : undefined;
}
