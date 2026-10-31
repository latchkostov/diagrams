import { tracks } from "./catalog";
import type { StoredTutorials } from "./progress";
import { earnedSeals, type SealLesson } from "./seals";
import { tutorialRoute } from "./route";
import type { Tutorial } from "./types";

/** Session-only navigation belongs to the lazy tutorial surface, never startup or persistent progress. */
export const lessonReturn: { lesson?: Tutorial; start?: string } = {};

export function leaveLesson(lesson: Tutorial) {
  lessonReturn.lesson = lesson;
  tutorialRoute.close("tutorials");
}

export function startNextLesson(lesson: Tutorial) {
  lessonReturn.start = lesson.id;
  tutorialRoute.open(lesson.id, true);
}

export function lessonNumber(lesson: Tutorial, catalog: readonly Tutorial[]) {
  return `${tracks.findIndex((track) => track.id === lesson.track) + 1}.${catalog.filter((x) => x.track === lesson.track).findIndex((x) => x.id === lesson.id) + 1}`;
}

export function justEarnedSeals(before: StoredTutorials, after: StoredTutorials, catalog: readonly SealLesson[]) {
  const previous = new Set(earnedSeals(before, catalog));
  return earnedSeals(after, catalog).filter((id) => !previous.has(id));
}
