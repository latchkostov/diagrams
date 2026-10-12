// Keys typed between picking a node in quick-add and its label editor taking focus (React Flow measures a
// new card before it's shown, and a hidden field can't be focused). They belong to the name: they're held
// here, kept from the canvas shortcuts (T would add a text), and handed to the editor when it opens.

/** What was typed: `text` is null until a key changes the name (the stencil's name is kept). */
export interface TypeAhead {
  text: string | null;
  /** Enter (keep what's typed) or Esc (keep the stencil's name) before the editor opened. */
  done?: "enter" | "escape";
}

type Key = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">;

/** The next state for a key, or null when the key isn't for the name (it's left alone). */
export function typeAheadKey(s: TypeAhead, e: Key): TypeAhead | null {
  if (s.done || e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.key === "Enter") return { ...s, done: "enter" };
  if (e.key === "Escape") return { ...s, done: "escape" };
  // The name starts selected: the first key replaces it, as it would in the editor.
  if (e.key === "Backspace") return { text: (s.text ?? "").slice(0, -1) };
  if (e.key.length === 1) return { text: (s.text ?? "") + e.key };
  return null;
}

let active: TypeAhead | null = null;

/** True while keys are being held for a new node's name (the canvas shortcuts stand aside). */
export const typeAheadActive = () => active !== null;

/**
 * Starts holding keys typed anywhere (capture phase, before the canvas sees them). `stop` ends it and
 * returns what was typed.
 */
export function captureTypeAhead(): { stop: () => TypeAhead } {
  active = { text: null };
  const onKey = (e: KeyboardEvent) => {
    if (!active) return;
    const next = typeAheadKey(active, e);
    if (!next) return;
    active = next;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  window.addEventListener("keydown", onKey, true);
  return {
    stop: () => {
      window.removeEventListener("keydown", onKey, true);
      const typed = active ?? { text: null };
      active = null;
      return typed;
    },
  };
}
