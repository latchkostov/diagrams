// Holding the page's input while a long task reads it: an image export clones the canvas over many slices, and a key,
// a click, the wheel or a dropped file between two slices would change what it is reading.
//
// Window capture listeners run in the order they were added, and the editor's shortcuts and the command palette add
// theirs as they mount: src/main.tsx imports this module first, so its listener runs before every one of them. It does
// nothing until a task holds the input.
//
// While held: Escape goes to the holder (an export cancels), Tab stays where it is (focus on the toast's Cancel), and
// the toasts still take their own clicks and keys (the Cancel button; the editor leaves overlays' events alone).

const HELD = [
  "pointerdown",
  "pointerup",
  "pointermove",
  "click",
  "dblclick",
  "contextmenu",
  "keydown",
  "keyup",
  "dragenter",
  "dragover",
  "drop",
  "paste",
] as const;

let holder: { onEscape?: () => void } | null = null;

function hold(e: Event) {
  if (!holder) return;
  const key = e instanceof KeyboardEvent ? e.key : undefined;
  const inToast = e.target instanceof Element && !!e.target.closest("[data-toast]");
  if (inToast && key !== "Escape" && key !== "Tab") return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (key === "Escape" && e.type === "keydown") holder.onEscape?.();
}

if (typeof window !== "undefined") for (const type of HELD) window.addEventListener(type, hold, true);

/**
 * Holds the page's input until the returned release. Escape is told to `onEscape`. The wheel is held only meanwhile:
 * a wheel listener that can cancel makes every scroll wait for the main thread. The window's other wheel listeners
 * only watch (they are passive: a fit stops, a menu closes), so they may run before it.
 */
export function holdInput(onEscape?: () => void): () => void {
  const me = { onEscape };
  holder = me;
  window.addEventListener("wheel", hold, { capture: true, passive: false });
  return () => {
    if (holder !== me) return;
    holder = null;
    window.removeEventListener("wheel", hold, { capture: true });
  };
}

/** Whether a task holds the input (for tests). */
export const inputHeld = () => holder !== null;
