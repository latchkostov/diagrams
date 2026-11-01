import { AI_TOOLS } from "../lib/deployment";
import { ROOMS } from "../lib/localOnly";
import type { TutorialMetadata } from "./types";

/** Build capabilities never change catalog order or persisted lesson identity. */
export function tutorialAvailable(lesson: Pick<TutorialMetadata, "optional">): boolean {
  return lesson.optional === "ai" ? AI_TOOLS : lesson.optional === "collaboration" ? ROOMS : true;
}
