// Esc while the page is full screen leaves full screen, and nothing else: the next Esc backs out of the app's own
// layers (docs/UX-PRINCIPLES.md, Esc). Browsers usually take that Esc themselves; this covers the ones that pass it on.
//
// Window capture listeners run in the order they were added, and several layers add one as they mount (slow
// motion, the live view, the recorder, menus). src/main.tsx imports this module first, before any other code
// runs, so this listener is always the first: full screen comes first whichever mode was entered first.

type EscEvent = Pick<KeyboardEvent, "key" | "preventDefault" | "stopImmediatePropagation">;

/** Handles Esc while `doc` is full screen; true when it did. */
export function escapeFullscreen(e: EscEvent, doc: Document = document): boolean {
  if (e.key !== "Escape" || !doc.fullscreenElement) return false;
  e.preventDefault();
  e.stopImmediatePropagation();
  void doc.exitFullscreen().catch(() => {});
  return true;
}

if (typeof window !== "undefined") window.addEventListener("keydown", (e) => escapeFullscreen(e), true);
