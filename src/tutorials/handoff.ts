import { chapters } from "./chapters";
import type { StoredTutorials } from "./progress";
import { earnedSeals, type SealLesson } from "./seals";
import { tutorialRoute } from "./route";
import type { Tutorial } from "./types";

/** Session-only navigation belongs to the lazy tutorial surface, never startup or persistent progress. */
type LessonIdentity = Pick<Tutorial, "id" | "track">;
export const lessonReturn: { lesson?: LessonIdentity } = {};
let pendingStart: string | undefined;
let stopWatching: (() => void) | undefined;

/** A route change abandons the handoff's intent, even when the destination lesson never mounts. */
export function cancelLessonStart() {
  pendingStart = undefined;
  stopWatching?.();
  stopWatching = undefined;
}

export function takeLessonStart(id: string): boolean {
  const start = pendingStart === id;
  cancelLessonStart();
  return start;
}

export function leaveLesson(lesson: LessonIdentity) {
  lessonReturn.lesson = lesson;
  tutorialRoute.returnTo("tutorials");
}

export function startNextLesson(lesson: Tutorial) {
  cancelLessonStart();
  pendingStart = lesson.id;
  tutorialRoute.open(lesson.id, true);
  if (pendingStart) stopWatching = tutorialRoute.subscribe(cancelLessonStart);
}

export function lessonNumber(lesson: LessonIdentity, catalog: readonly LessonIdentity[]) {
  return `${chapters[lesson.track].order}.${catalog.filter((x) => x.track === lesson.track).findIndex((x) => x.id === lesson.id) + 1}`;
}

export function justEarnedSeals(before: StoredTutorials, after: StoredTutorials, catalog: readonly SealLesson[]) {
  const previous = new Set(earnedSeals(before, catalog));
  return earnedSeals(after, catalog).filter((id) => !previous.has(id));
}
