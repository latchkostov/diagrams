// Keys typed before a field can take them: between picking a node in quick-add and its label editor taking
// focus (React Flow measures a new card before it's shown, and a hidden field can't be focused), or between
// Ctrl+K and the palette's search appearing (its code may still be loading). They belong to the field:
// they're held here, kept from the canvas shortcuts (T would add a text), and handed over when it opens.

/** What was typed: `text` is null until a key changes the name (the stencil's name is kept). */
export interface TypeAhead {
  text: string | null;
  /** Enter or Esc finishes the name before the editor opened, keeping what was typed. */
  done?: "enter" | "escape";
}

type Key = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">;
type HeldInput = { key: Key } | { paste: string };
interface PendingTypeAhead {
  inputs: readonly HeldInput[];
}

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
type Capture = { closeModal?: () => void; accept?(typed: TypeAhead | PendingTypeAhead): void };
const captures: Capture[] = [];

function inputFrom(event: Event): HeldInput | null {
  if (event.type === "paste") {
    const paste = (event as ClipboardEvent).clipboardData?.getData("text/plain");
    return paste ? { paste } : null;
  }
  const { key, ctrlKey, metaKey, altKey, isComposing } = event as KeyboardEvent;
  return isComposing ? null : { key: { key, ctrlKey, metaKey, altKey } };
}

function nextInput(state: TypeAhead, input: HeldInput, multiline: boolean): TypeAhead | null {
  if (state.done) return null;
  return "paste" in input
    ? { text: (state.text ?? "") + (multiline ? input.paste : input.paste.replace(/[\r\n]+/g, " ")) }
    : typeAheadKey(state, input.key, multiline);
}

function listen(capture: Capture, onInput: (event: Event) => void): () => void {
  captures.push(capture);
  const events = ["keydown", "paste"];
  for (const type of events) window.addEventListener(type, onInput, true);
  return () => {
    const index = captures.indexOf(capture);
    if (index < 0) return;
    for (const type of events) window.removeEventListener(type, onInput, true);
    captures.splice(index, 1);
  };
}

/** A deferred pick does not know yet whether Enter finishes a name or adds an annotation newline. */
export function capturePendingTypeAhead(): { stop: () => PendingTypeAhead; resume: () => void } {
  const capture: Capture = {};
  const inputs: HeldInput[] = [];
  const typed = { inputs };
  const onInput = (event: Event) => {
    if (captures.at(-1) !== capture) return;
    const input = inputFrom(event);
    if (!input || !nextInput({ text: null }, input, true)) return;
    inputs.push(input);
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  let stopListening: (() => void) | undefined;
  // A failed deferred search yields the keyboard, keeping its input for Retry.
  const resume = () => {
    stopListening ??= listen(capture, onInput);
  };
  resume();
  return {
    resume,
    stop() {
      stopListening?.();
      stopListening = undefined;
      return typed;
    },
  };
}

/** Pass keys held after a deferred menu pick to the name capture that its action just opened. */
export function handoffTypeAhead(typed: TypeAhead | PendingTypeAhead): void {
  const owner = captures.at(-1);
  // Metadata arrives in a React effect; naming may flush a document commit. Finish outside that
  // effect, and keep the destination's identity so cancellation cannot name a newer field instead.
  queueMicrotask(() => {
    if (owner && captures.includes(owner)) owner.accept?.(typed);
  });
}

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

/** A modal still downloading owns the keyboard (the palette's loading frame): focus inside it isn't leaving. */
export const pendingTypeAheadModal = () => captures.some((c) => c.closeModal);

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
    accept(typed: TypeAhead | PendingTypeAhead) {
      if ("inputs" in typed) {
        for (const input of typed.inputs) {
          const next = nextInput(me.state, input, multiline());
          if (next) me.state = next;
          if (next?.done) {
            onDone?.(next);
            break;
          }
        }
      } else {
        me.state = typed;
        if (typed.done) onDone?.(typed);
      }
    },
    closeModal: closeModal
      ? () => {
          me.state = { ...me.state, done: "escape" };
          stop();
          closeModal();
        }
      : undefined,
  };
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
    const input = inputFrom(event);
    if (!input || ("key" in input && input.key.key === "Escape" && escape === "controller")) return;
    const next = nextInput(me.state, input, multiline());
    if (!next) return;
    me.state = next;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (next.done === "escape" && me.closeModal) me.closeModal();
    if (next.done) onDone?.(next);
  };
  const stopListening = listen(me, onInput);
  const stop = () => {
    stopListening();
    return me.state;
  };
  return { stop, read: () => me.state };
}
