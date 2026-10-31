import type { StoredTutorials } from "./progress";
import type { TrackId, Tutorial } from "./types";

export const chapterSeals = [
  { id: "chapter-basics", track: "basics", numeral: "I" },
  { id: "chapter-blocks", track: "blocks", numeral: "II" },
  { id: "chapter-simulation", track: "simulation", numeral: "III" },
  { id: "chapter-waiting", track: "waiting", numeral: "IV" },
  { id: "chapter-resilience", track: "resilience", numeral: "V" },
  { id: "chapter-studies", track: "studies", numeral: "VI" },
] as const satisfies readonly { id: string; track: TrackId; numeral: string }[];
export const seals = [...chapterSeals, { id: "whole-syllabus", track: undefined, numeral: "✓" }] as const;
export type SealId = (typeof seals)[number]["id"];
export type SealLesson = Pick<Tutorial, "id" | "version" | "track" | "quarantined">;

export function lessonProgress(progress: StoredTutorials, lesson: SealLesson) {
  const saved = progress.progress?.[lesson.id];
  if (lesson.quarantined || saved?.version !== lesson.version) return undefined;
  return Number.isInteger(saved.step) && saved.step >= 0 ? saved : { ...saved, step: 0 };
}

/** Pure rules, including retained awards: a new lesson version cannot revoke a seal. */
export function earnedSeals(progress: StoredTutorials, catalog: readonly SealLesson[]): SealId[] {
  return seals
    .filter((seal) => {
      if (progress.marks?.[seal.id] !== undefined) return true;
      const lessons = catalog.filter((lesson) => !lesson.quarantined && (!seal.track || lesson.track === seal.track));
      return lessons.length > 0 && lessons.every((lesson) => lessonProgress(progress, lesson)?.completed);
    })
    .map((seal) => seal.id);
}
