import type { JournalEntry } from "./controller";

declare global {
  interface Window {
    /** E2E and development builds only: every camera command the canvas ran, in order (see controller.ts). */
    __cameraJournal?: JournalEntry[];
  }
}

/**
 * The e2e command journal: what the camera did and why ("after the pick: a reveal for the placement, no fit").
 * Only development and e2e (VITE_E2E=1) builds have it; production folds this to undefined, and vite.config.ts's
 * noTestHooks() fails a production build that still names `__cameraJournal`.
 */
export const cameraJournal: ((entry: JournalEntry) => void) | undefined =
  import.meta.env.DEV || import.meta.env.VITE_E2E === "1"
    ? (entry) => {
        if (typeof window !== "undefined") (window.__cameraJournal ??= []).push(entry);
      }
    : undefined;
