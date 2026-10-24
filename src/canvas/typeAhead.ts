// Keys typed before a field can take them: between picking a node in quick-add and its label editor taking
// focus (React Flow measures a new card before it's shown, and a hidden field can't be focused), or between
// Ctrl+K and the palette's search appearing (its code may still be loading). They belong to the field:
// they're held here, kept from the canvas shortcuts (T would add a text), and handed over when it opens.

/** What was typed: `text` is null until a key changes the name (the stencil's name is kept). */
export interface TypeAhead {
  text: string | null;
  /** Enter (keep what's typed) or Esc (keep the stencil's name) before the editor opened. */
  done?: "enter" | "escape";
}

type Key = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">;

/** The next state for a key, or null when the key isn't for the name (it's left alone). */
export function typeAheadKey(s: TypeAhead, e: Key, multiline = false): TypeAhead | null {
  if (s.done) return null;
  if (multiline && e.key === "Enter")
    return e.ctrlKey || e.metaKey ? { ...s, done: "enter" } : { text: (s.text ?? "") + "\n" };
  if (multiline && e.key === "Tab") return { ...s, done: "enter" };
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.key === "Enter") return { ...s, done: "enter" };
  if (e.key === "Escape") return { ...s, done: "escape" };
  // The name starts selected: the first key replaces it, as it would in the editor.
  if (e.key === "Backspace") return { text: (s.text ?? "").slice(0, -1) };
  if (e.key.length === 1) return { text: (s.text ?? "") + e.key };
  return null;
}

/** The captures running, newest last: only the newest takes keys (a menu's search inside the palette's). */
const captures: { state: TypeAhead }[] = [];

/** True while keys are being held for a field that isn't focused yet (the canvas shortcuts stand aside). */
export const typeAheadActive = () => captures.length > 0;

/**
 * Starts holding keys typed anywhere (capture phase, before the canvas sees them): for a new node's name
 * while its card is measured, for a renamed item's field while its panel downloads, or for the palette's search
 * while it loads. `stop` ends it and returns what was typed; calling it again returns the same. `onDone` hears the
 * Enter or Esc that finished the typing (the key is held too).
 */
export function captureTypeAhead(
  multiline: () => boolean = () => false,
  onDone?: (typed: TypeAhead) => void,
  accepts: (event: KeyboardEvent) => boolean = () => true,
): { stop: () => TypeAhead } {
  const me = { state: { text: null } as TypeAhead };
  captures.push(me);
  const onKey = (e: KeyboardEvent) => {
    if (captures[captures.length - 1] !== me || e.isComposing || !accepts(e)) return;
    const next = typeAheadKey(me.state, e, multiline());
    if (!next) return;
    me.state = next;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (next.done) onDone?.(next);
  };
  window.addEventListener("keydown", onKey, true);
  let stopped = false;
  return {
    stop: () => {
      if (!stopped) {
        stopped = true;
        window.removeEventListener("keydown", onKey, true);
        captures.splice(captures.indexOf(me), 1);
      }
      return me.state;
    },
  };
}
