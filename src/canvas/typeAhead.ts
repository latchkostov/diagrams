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
const captures: { state: TypeAhead; closeModal?: () => void }[] = [];

/** A modal owns Escape as soon as its input capture starts, including while its chunk is pending. */
export function dismissPendingTypeAheadModal(): boolean {
  const close = captures.at(-1)?.closeModal;
  if (!close) return false;
  close();
  return true;
}

/** Starts modal ownership before any dialog DOM exists; stopping the capture releases that ownership. */
export function captureModalTypeAhead(close: () => void): { stop: () => TypeAhead } {
  return captureTypeAhead(undefined, undefined, false, "capture", close);
}

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
  // A rename yields to other fields; a palette may have been opened from one and still owns its pending input.
  respectEditable = false,
  // Pending Inspector names route Escape through the interaction controller's modal precedence.
  escape: "capture" | "controller" = "capture",
  closeModal?: () => void,
  text: string | null = null,
): { stop: () => TypeAhead; read: () => TypeAhead } {
  const me = {
    state: { text } as TypeAhead,
    closeModal: closeModal
      ? () => {
          me.state = { ...me.state, done: "escape" };
          stop();
          closeModal();
        }
      : undefined,
  };
  captures.push(me);
  const onInput = (event: Event) => {
    if (
      captures.at(-1) !== me ||
      me.state.done ||
      (respectEditable &&
        event.target instanceof Element &&
        event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'))
    )
      return;
    // A pending modal's own buttons (Close, Retry) take Enter and Space; typing anywhere else is still held.
    if (
      me.closeModal &&
      event instanceof KeyboardEvent &&
      (event.key === "Enter" || event.key === " ") &&
      event.target instanceof Element &&
      event.target.closest('[aria-modal="true"]') &&
      event.target.closest('button, a[href], [role="button"]')
    )
      return;
    let next: TypeAhead | null;
    if (event.type === "paste") {
      const text = (event as ClipboardEvent).clipboardData?.getData("text/plain");
      if (!text) return;
      next = { text: (me.state.text ?? "") + (multiline() ? text : text.replace(/[\r\n]+/g, " ")) };
    } else {
      const key = event as KeyboardEvent;
      if (key.key === "Escape" && escape === "controller") return;
      next = key.isComposing ? null : typeAheadKey(me.state, key, multiline());
    }
    if (!next) return;
    me.state = next;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (next.done === "escape" && me.closeModal) me.closeModal();
    if (next.done) onDone?.(next);
  };
  const events = ["keydown", "paste"];
  for (const type of events) window.addEventListener(type, onInput, true);
  const stop = () => {
    const index = captures.indexOf(me);
    if (index >= 0) {
      for (const type of events) window.removeEventListener(type, onInput, true);
      captures.splice(index, 1);
    }
    return me.state;
  };
  return { stop, read: () => me.state };
}
