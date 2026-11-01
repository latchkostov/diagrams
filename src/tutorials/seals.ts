import type { StoredTutorials } from "./progress";
import { tracks } from "./chapters";
import type { Tutorial } from "./types";

export const chapterSeals = tracks.map((chapter) => ({
  id: chapter.seal,
  track: chapter.id,
  numeral: chapter.numeral,
}));
export const seals = [...chapterSeals, { id: "whole-syllabus", track: undefined, numeral: "✓" }] as const;
export type SealId = (typeof seals)[number]["id"];
export type SealLesson = Pick<
  Tutorial,
  "id" | "version" | "track" | "quarantined" | "optional" | "completionFromVersion"
>;

export function lessonProgress(progress: StoredTutorials, lesson: SealLesson) {
  const saved = progress.progress?.[lesson.id];
  if (
    lesson.quarantined ||
    (saved?.version !== lesson.version && !(saved?.completed && saved.version === lesson.completionFromVersion))
  )
    return undefined;
  return Number.isInteger(saved.step) && saved.step >= 0 ? saved : { ...saved, step: 0 };
}

/** Pure rules, including retained awards: a new lesson version cannot revoke a seal. */
export function earnedSeals(progress: StoredTutorials, catalog: readonly SealLesson[]): SealId[] {
  return seals
    .filter((seal) => {
      if (progress.marks?.[seal.id] !== undefined) return true;
      const lessons = catalog.filter(
        (lesson) => !lesson.quarantined && !lesson.optional && (!seal.track || lesson.track === seal.track),
      );
      return lessons.length > 0 && lessons.every((lesson) => lessonProgress(progress, lesson)?.completed);
    })
    .map((seal) => seal.id);
}
