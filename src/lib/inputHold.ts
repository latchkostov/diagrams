// Holding the page's input while a long task reads it: an image export clones the canvas over many slices, and a key,
// a click, the wheel or a dropped file between two slices would change what it is reading.
//
// Window capture listeners run in the order they were added, and the editor's shortcuts and the command palette add
// theirs as they mount: src/main.tsx imports this module first, so its listener runs before every one of them. It does
// nothing until a task holds the input.
//
// While held: Escape goes to the latest holder (an export cancels), and only the toasts' own buttons still work: a
// click, or Enter or Space on one (the export's Cancel has the focus). Every other key stays here, Tab included, so no
// shortcut (Ctrl+K, Ctrl+O) opens anything over a task that is reading the page.

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

/** The tasks holding the input, latest last: one releasing doesn't free the page while another still reads it. */
const holders: { onEscape?: () => void }[] = [];

/** A toast's button pressed: a click, or a plain Enter or Space on it. */
function pressesToastButton(e: Event) {
  if (!(e.target instanceof Element) || !e.target.closest("[data-toast] button")) return false;
  if (!(e instanceof KeyboardEvent)) return true;
  return (e.key === "Enter" || e.key === " ") && !e.ctrlKey && !e.metaKey && !e.altKey;
}

function hold(e: Event) {
  const holder = holders.at(-1);
  if (!holder || pressesToastButton(e)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e instanceof KeyboardEvent && e.key === "Escape" && e.type === "keydown") holder.onEscape?.();
}

if (typeof window !== "undefined") for (const type of HELD) window.addEventListener(type, hold, true);

/**
 * Holds the page's input until the returned release. Escape is told to `onEscape`. The wheel is held only meanwhile:
 * a wheel listener that can cancel makes every scroll wait for the main thread. The window's other wheel listeners
 * only watch (they are passive: a fit stops, a menu closes), so they may run before it.
 */
export function holdInput(onEscape?: () => void): () => void {
  const me = { onEscape };
  if (!holders.length) window.addEventListener("wheel", hold, { capture: true, passive: false });
  holders.push(me);
  return () => {
    const at = holders.indexOf(me);
    if (at < 0) return;
    holders.splice(at, 1);
    if (!holders.length) window.removeEventListener("wheel", hold, { capture: true });
  };
}

/** Whether a task holds the input (for tests). */
export const inputHeld = () => holders.length > 0;
