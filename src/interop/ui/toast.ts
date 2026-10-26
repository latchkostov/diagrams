// App-wide toasts. A tiny external store, so any module (not just components) can report
// progress or errors: `toast.info("Saved")`, `toast.error("...")`, `toast.busy("Rendering…")`.
// One visible toast per layer (docs/design-review/2026-10-25-toast-layering.md). The page layer shows one
// notification at a time; a task holding page input owns its Cancel until it finishes, and other notifications
// wait behind it (latest wins, as with ordinary toasts). An engaged toast likewise keeps its action until the
// pointer, keyboard focus and any press have left. While a modal is open the page's notifications step back (out
// of reach, expiry paused); a notification raised meanwhile shows in that dialog's feedback slot, beside it, under
// the same rules, and returns to the page if it outlives the dialog.

import { createMachine } from "../../lib/machine";
import { modalLayers, type ModalLayer } from "../../lib/modalLayers";
import { toastEngagement, type ToastContact } from "./toastEngagement";

export type ToastKind = "info" | "success" | "error" | "busy";

export interface ToastAction {
  label: string;
  run: () => void;
  testId?: string;
  /** Takes the keyboard focus when it shows (a long task's Cancel), and gives it back when the toast goes. */
  focus?: boolean;
  /**
   * Bind to the current editor history entry. Later edits invalidate this action, including while retained.
   */
  undoes?: boolean;
}

export interface ToastState {
  id: number;
  kind: ToastKind;
  text: string;
  action?: ToastAction;
  undoEntryId?: object;
  undoUnavailable?: boolean;
  /** ms; 0 = sticky until replaced or dismissed. */
  duration: number;
  /** A busy task's share done (0 to 1), once it reports one. */
  progress?: number;
  /** Owns the toast until the task dismisses it; other notifications cannot hide Cancel. */
  blocking?: boolean;
  /** Releases resources only once this notification can no longer be used. */
  onDismiss?: () => void;
  /** The modal layer this is feedback for: shown in that dialog, gone with it. Absent: the page layer. */
  layer?: number;
}

/** A shown dialog feedback toast, with the open modal layer it renders in. */
export interface LayeredToast {
  layer: ModalLayer;
  toast: ToastState;
  engaged: boolean;
}

const newContact = () => createMachine(toastEngagement);

/** One modal layer's feedback: latest wins, but an engaged toast holds its place until released. */
interface LayerSlot {
  shown: ToastState;
  waiting: ToastState | null;
  contact: ReturnType<typeof newContact>;
}

let current: ToastState | null = null;
let deferred: ToastState | null = null;
let held: ToastState | null = null;
const contact = newContact();
const blocking: ToastState[] = [];
const slots = new Map<number, LayerSlot>();
let layered: readonly LayeredToast[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const dismissOnRelease = new Set<number>();
let live = new Map<number, ToastState>();
/** The document is ahead of its history (an edit not yet recorded): not a reason to call an Undo stale. */
export const HISTORY_PENDING = "pending";
let undoHistory:
  | {
      /** Records any pending edit, then the entry Undo would reverse. */
      capture(): object | undefined;
      /** The entry Undo would reverse, without recording; HISTORY_PENDING while an edit is unrecorded. */
      current(): object | undefined | typeof HISTORY_PENDING;
    }
  | undefined;
const emit = () => listeners.forEach((l) => l());

type NoticeOptions = Pick<ToastOptions, "action" | "duration">;

interface ToastOptions {
  action?: ToastAction;
  duration?: number;
  blocking?: boolean;
  onDismiss?: () => void;
}

const sameLayered = (a: readonly LayeredToast[], b: readonly LayeredToast[]) =>
  a.length === b.length &&
  a.every((l, i) => l.layer === b[i].layer && l.toast === b[i].toast && l.engaged === b[i].engaged);

function publish() {
  const inLayers = [...slots.values()].flatMap((slot) => [slot.shown, slot.waiting]);
  const next = new Map(
    [...blocking, deferred, held, ...inLayers].filter((t): t is ToastState => t !== null).map((t) => [t.id, t]),
  );
  const removed = [...live.values()].filter((t) => !next.has(t.id));
  live = next;
  current = blocking.at(-1) ?? held ?? deferred;
  const nextLayered = [...slots].flatMap(([id, slot]) => {
    const layer = modalLayers.get(id);
    return layer ? [{ layer, toast: slot.shown, engaged: slot.contact.state.value === "engaged" }] : [];
  });
  // The same snapshot while nothing in the layers changed: history moving must not re-render the Toaster.
  if (!sameLayered(layered, nextLayered)) layered = nextLayered;
  for (const t of removed) {
    dismissOnRelease.delete(t.id);
    t.onDismiss?.();
  }
  emit();
}

const slotOf = (id: number | undefined) =>
  id === undefined ? undefined : [...slots.values()].find((s) => s.shown.id === id || s.waiting?.id === id);

/** The waiting feedback takes the slot once nothing engages the shown one. */
function advance(slot: LayerSlot) {
  if (!slot.waiting || slot.contact.state.value === "engaged") return;
  slot.shown = slot.waiting;
  slot.waiting = null;
  slot.contact.send({ type: "reset" });
}

// A notification that outlives its dialog returns to the page (latest wins there, as ever), so an Undo or a Retry
// raised beside a dialog is never lost with it. The one it replaces releases its resources once, as any removal.
modalLayers.subscribe(() => {
  // Modal ownership is a contact of its own: focus moving into the modal must not release its opener.
  const openers = new Set(
    modalLayers.openers.map((el) => Number(el.closest<HTMLElement>("[data-toast-id]")?.dataset.toastId)),
  );
  if (current && openers.has(current.id)) toast.contact("opener", true, current.id);
  if (held && !openers.has(held.id)) {
    // React suppresses synthetic focus events during modal cleanup. Sample the synchronous focus return before
    // dropping ownership, so the returned keyboard contact survives that commit too.
    if (contact.state.opener && typeof document !== "undefined")
      toast.contact(
        "focus",
        document.activeElement?.closest<HTMLElement>("[data-toast-id]")?.dataset.toastId === String(held.id),
        held.id,
      );
    toast.contact("opener", false, held?.id);
  }
  for (const [id, slot] of [...slots]) {
    if (modalLayers.has(id)) continue;
    slots.delete(id);
    const survivor = { ...(slot.waiting ?? slot.shown), layer: undefined };
    if (!deferred || deferred.id < survivor.id) deferred = survivor;
  }
  publish();
});

function show(kind: ToastKind, text: string, opts: ToastOptions = {}): number {
  const history = undoHistory;
  // Bound only where a mounted canvas owns history; without one (a harness, a viewer) Undo keeps the unbound rule:
  // it goes the moment anything else undoes or redoes (dismissUndo).
  const bound = !!(opts.action?.undoes && history);
  const undoEntryId = bound ? history!.capture() : undefined;
  const duration = opts.duration ?? (kind === "busy" ? 0 : kind === "error" ? 8000 : opts.action ? 6000 : 3500);
  const next = {
    id: ++seq,
    kind,
    text,
    action:
      bound && opts.action
        ? {
            ...opts.action,
            run: () => {
              if (undoEntryId && history?.capture() === undoEntryId && live.get(next.id)?.undoUnavailable === false)
                opts.action!.run();
              else toast.invalidateUndo();
            },
          }
        : opts.action,
    undoEntryId,
    undoUnavailable: bound ? !undoEntryId : false,
    duration,
    blocking: opts.blocking,
    onDismiss: opts.onDismiss,
  };
  // Raised while a dialog is open: shown beside it, never behind it (and never over its controls).
  const layer = opts.blocking ? null : modalLayers.top;
  if (layer?.feedback) {
    const feedback = { ...next, layer: layer.id };
    const slot = slots.get(layer.id);
    if (!slot) slots.set(layer.id, { shown: feedback, waiting: null, contact: newContact() });
    else if (slot.contact.state.value === "engaged") slot.waiting = feedback;
    else slot.shown = feedback;
  } else if (opts.blocking) {
    if (!blocking.length) deferred = null;
    blocking.push(next);
  } else deferred = next;
  publish();
  return next.id;
}

export const toast = {
  /** The mounted canvas owns history; capture flushes pending edits before binding an Undo. */
  bindHistory(history: NonNullable<typeof undoHistory>) {
    undoHistory = history;
    return () => {
      if (undoHistory !== history) return;
      undoHistory = undefined;
      toast.invalidateUndo();
    };
  },
  /**
   * Keep an engaged notification in place, but never keep an obsolete Undo alive. While an edit is still
   * unrecorded nothing is decided; `settle` records it first (activation), so a merged edit keeps the Undo and a new
   * entry makes it stale.
   */
  invalidateUndo(settle = false) {
    const entryId = settle ? undoHistory?.capture() : undoHistory?.current();
    if (entryId === HISTORY_PENDING) return;
    const invalidate = (t: ToastState | null): ToastState | null =>
      t?.action?.undoes && t.undoEntryId !== undefined && !t.undoUnavailable && t.undoEntryId !== entryId
        ? { ...t, undoUnavailable: true }
        : t;
    held = invalidate(held);
    deferred = invalidate(deferred);
    for (let i = 0; i < blocking.length; i++) blocking[i] = invalidate(blocking[i])!;
    for (const slot of slots.values()) {
      slot.shown = invalidate(slot.shown)!;
      slot.waiting = invalidate(slot.waiting);
    }
    publish();
  },
  canRunAction(id: number) {
    toast.invalidateUndo(true);
    const t = live.get(id);
    return !!t?.action && !t.undoUnavailable;
  },
  info: (text: string, opts?: NoticeOptions) => show("info", text, opts),
  success: (text: string, opts?: NoticeOptions) => show("success", text, opts),
  error: (text: string, opts?: NoticeOptions) => show("error", text, opts),
  /** Sticky until dismissed; a long task may offer its cancel as the action and report `progress`. */
  busy: (text: string, opts?: { action?: ToastAction; blocking?: boolean }) => show("busy", text, opts),
  /** How far busy toast `id` has got (0 to 1), including an owner behind a newer task. */
  progress(id: number, done: number) {
    const at = blocking.findIndex((t) => t.id === id);
    const task =
      at >= 0 ? blocking[at] : deferred?.id === id ? deferred : held?.id === id ? held : (slotOf(id)?.shown ?? null);
    if (!task || task.progress === done) return;
    if (at >= 0) blocking[at] = { ...blocking[at], progress: done };
    else if (deferred?.id === id) deferred = { ...deferred, progress: done };
    if (held?.id === id) held = { ...held, progress: done };
    for (const slot of slots.values()) if (slot.shown.id === id) slot.shown = { ...slot.shown, progress: done };
    publish();
  },
  /** Dismisses `id`, or ordinary notifications if omitted. Only a task's owner dismisses its blocking toast. */
  dismiss(id?: number) {
    if (held && (id === undefined || id === held.id) && contact.state.opener) {
      dismissOnRelease.add(held.id);
      if (id !== undefined) return;
    }
    const slot = slotOf(id);
    if (slot) {
      if (slot.waiting?.id === id) slot.waiting = null;
      else if (slot.waiting) {
        slot.contact.send({ type: "reset" });
        advance(slot);
      } else slots.delete(slot.shown.layer!);
      publish();
      return;
    }
    if (id === undefined) slots.clear();
    const release = held && !contact.state.opener && (held.id === id || (id === undefined && !held.blocking));
    if (release) {
      held = null;
      contact.send({ type: "reset" });
    }
    const at = blocking.findIndex((t) => t.id === id);
    if (at >= 0) blocking.splice(at, 1);
    else if (id === undefined || deferred?.id === id) deferred = null;
    else if (!release) return;
    publish();
  },
  /** Removes an ordinary Undo toast, visible or waiting: history just moved under it. */
  dismissUndo() {
    if (held?.action?.undoes) toast.dismiss(held.id);
    if (deferred?.action?.undoes) toast.dismiss(deferred.id);
    for (const slot of [...slots.values()]) {
      if (slot.waiting?.action?.undoes) toast.dismiss(slot.waiting.id);
      if (slot.shown.action?.undoes) toast.dismiss(slot.shown.id);
    }
  },
  /** Toaster's synchronous input boundary; no timer may move or replace an engaged action. */
  contact(contactType: ToastContact, active: boolean, id = current?.id) {
    const slot = slotOf(id);
    if (slot) {
      if (slot.shown.id !== id) return;
      slot.contact.send({ type: "contact", contact: contactType, active });
      advance(slot);
      publish();
      return;
    }
    // A sticky task owns its controls independently of ordinary toast engagement.
    if (id === current?.id && current?.blocking) return;
    if (id !== current?.id && (active || id !== held?.id)) return;
    contact.send({ type: "contact", contact: contactType, active });
    if (contact.state.value === "engaged") held ??= current;
    else {
      if (held && dismissOnRelease.delete(held.id) && deferred?.id === held.id) deferred = null;
      held = null;
    }
    publish();
  },
  /** A press ended anywhere (pointerup, pointercancel, window blur): every layer hears it. */
  endPress() {
    toast.contact("press", false, toast.retained?.id ?? toast.current?.id);
    for (const slot of [...slots.values()]) toast.contact("press", false, slot.shown.id);
  },
  release() {
    contact.send({ type: "reset" });
    held = null;
    for (const slot of slots.values()) {
      slot.contact.send({ type: "reset" });
      advance(slot);
    }
    publish();
  },
  get engaged() {
    return contact.state.value === "engaged";
  },
  /** Whether toast `id`'s own layer is engaged (the page's notification, or a dialog's feedback). */
  engagedFor(id: number) {
    const slot = slotOf(id);
    return (slot ? slot.contact : contact).state.value === "engaged";
  },
  /** A modal is open: the page's ordinary notifications step back until it closes. */
  get steppedBack() {
    return modalLayers.open;
  },
  /** Dialog feedback shown now, each with the modal layer it renders in. */
  get layered() {
    return layered;
  },
  get current() {
    return current;
  },
  get retained() {
    return held?.id !== current?.id ? held : null;
  },
};

export interface NotifyOptions {
  kind?: ToastKind;
  /** One optional button, e.g. `{ label: "Undo", run: undo }`. */
  action?: ToastAction;
  /** ms; default depends on kind (errors linger, busy is sticky). */
  duration?: number;
  /** Cleanup after expiry, replacement or explicit dismissal (after an action has run). */
  onDismiss?: () => void;
}

/**
 * The app-wide toast, callable from anywhere (components, canvasBridge, actions). Returns an id for
 * `toast.dismiss(id)`. Example: `notify("Added Amazon SQS to Kafka order pipeline", { action: { label: "Undo", run } })`.
 */
export function notify(text: string, opts: NotifyOptions = {}): number {
  return show(opts.kind ?? "info", text, opts);
}

export function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
