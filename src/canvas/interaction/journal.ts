import type { InteractionEntry } from "./controller";

declare global {
  interface Window {
    /** Development and E2E builds only: every menu, focus and selection decision, in order (see controller.ts). */
    __interactionJournal?: InteractionEntry[];
  }
}

/**
 * The e2e interaction journal: what was decided and why ("menu.closed:escape -> focus:element@commit", then the
 * move's result). Development and e2e (VITE_E2E=1) builds have it; production folds this to undefined, and
 * vite.config.ts's noTestHooks() fails a production build that still names `__interactionJournal`.
 */
export const interactionJournal: ((entry: InteractionEntry) => void) | undefined =
  import.meta.env.DEV || import.meta.env.VITE_E2E === "1"
    ? (entry) => {
        if (typeof window !== "undefined") (window.__interactionJournal ??= []).push(entry);
      }
    : undefined;
