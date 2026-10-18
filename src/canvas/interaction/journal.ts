import type { InteractionEntry } from "./controller";

declare global {
  interface Window {
    /** E2E builds only: every menu, focus and selection decision the canvas made, in order (see controller.ts). */
    __interactionJournal?: InteractionEntry[];
  }
}

/**
 * The e2e interaction journal: what was decided and why ("menu.closed:escape -> focus:element@commit", then the
 * move's result). Only e2e (VITE_E2E=1) builds have it; every other build folds this to undefined, and
 * vite.config.ts's noTestHooks() fails a production build that still names `__interactionJournal`.
 */
export const interactionJournal: ((entry: InteractionEntry) => void) | undefined =
  import.meta.env.VITE_E2E === "1"
    ? (entry) => {
        if (typeof window !== "undefined") (window.__interactionJournal ??= []).push(entry);
      }
    : undefined;
