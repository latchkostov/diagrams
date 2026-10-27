// App-wide toasts. A tiny external store, so any module (not just components) can report
// progress or errors: `toast.info("Saved")`, `toast.error("...")`, `toast.busy("Rendering…")`.
// One visible toast per layer (docs/design-review/2026-10-25-toast-layering.md). The page layer shows one
// notification at a time; a task holding page input owns its Cancel until it finishes, and other notifications
// wait behind it (latest wins, as with ordinary toasts). An engaged toast likewise keeps its action until the
// pointer, keyboard focus and any press have left. While a modal is open the page's notifications step back (out
// of reach, expiry paused); a notification raised meanwhile shows in that dialog's feedback slot, beside it, under
// the same rules, and returns to the page if it outlives the dialog.

import { modalLayers } from "../../lib/modalLayers";
import { newContact, type ToastContact } from "./toastEngagement";

import {
  installToastRuntime,
  HISTORY_PENDING,
  type ToastAction,
  type ToastState,
  type LayeredToast,
  type ToastInput,
  toast as ingress,
} from "./toast";

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
const dismissOnRelease = new Set<number>();
let live = new Map<number, ToastState>();
let emit = () => {};

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
    const layer = modalLayers.stack.find((l) => l.id === id);
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
modalLayers.listeners.add(() => {
  // Modal ownership is a contact of its own: focus moving into the modal must not release its opener.
  const openers = new Set(
    modalLayers.stack
      .flatMap((l) => (l.opener ? [l.opener] : []))
      .map((el) => Number(el.closest<HTMLElement>("[data-toast-id]")?.dataset.toastId)),
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
    if (modalLayers.stack.some((l) => l.id === id)) continue;
    slots.delete(id);
    const survivor = { ...(slot.waiting ?? slot.shown), layer: undefined };
    if (!deferred || deferred.id < survivor.id) deferred = survivor;
  }
  publish();
});

/** Changes every notification the store holds, wherever it is, then publishes once. */
function each(change: (t: ToastState) => ToastState) {
  const maybe = (t: ToastState | null) => t && change(t);
  held = maybe(held);
  deferred = maybe(deferred);
  for (let i = 0; i < blocking.length; i++) blocking[i] = change(blocking[i]);
  for (const slot of slots.values()) {
    slot.shown = change(slot.shown);
    slot.waiting = maybe(slot.waiting);
  }
  publish();
}

function show(input: ToastInput) {
  const { history, undoEntryId, ...options } = input;
  const next: ToastState = {
    ...options,
    duration:
      input.duration ?? (input.kind === "busy" ? 0 : input.kind === "error" ? 8000 : input.action ? 6000 : 3500),
    undoUnavailable: history ? !undoEntryId : false,
    undoEntryId,
    action:
      history && input.action
        ? {
            ...input.action,
            run: () => {
              if (undoEntryId && history.capture() === undoEntryId && toast.canRunAction(input.id)) input.action!.run();
              else ingress.invalidateUndo();
            },
          }
        : input.action,
  };
  // Raised while a dialog is open: shown beside it, never behind it (and never over its controls).
  const layer = next.layer === undefined ? null : modalLayers.stack.find((l) => l.id === next.layer);
  if (layer?.feedback) {
    const feedback = { ...next, layer: layer.id };
    const slot = slots.get(layer.id);
    if (!slot) slots.set(layer.id, { shown: feedback, waiting: null, contact: newContact() });
    else if (slot.contact.state.value === "engaged") slot.waiting = feedback;
    else slot.shown = feedback;
  } else if (next.blocking) {
    if (!blocking.length) deferred = null;
    blocking.push(next);
  } else deferred = next;
  publish();
  return next.id;
}

export const toast = {
  show,
  invalidateUndo(entryId: object | undefined | typeof HISTORY_PENDING) {
    if (entryId === HISTORY_PENDING) return;
    each((t) =>
      t.action?.undoes && t.undoEntryId !== undefined && !t.undoUnavailable && t.undoEntryId !== entryId
        ? { ...t, undoUnavailable: true }
        : t,
    );
  },
  /** Gives notification `id` its action while it is live: shown, retained, waiting, a task's, or a dialog's. */
  attach(id: number, action: ToastAction) {
    // Timed as one raised with its action: long enough to reach it.
    each((t) => (t.id === id && !t.action ? { ...t, action, duration: t.duration && Math.max(t.duration, 6000) } : t));
  },
  canRunAction(id: number) {
    ingress.invalidateUndo(true);
    const t = live.get(id);
    return !!t?.action && !t.undoUnavailable && !t.actionConsumed;
  },
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
      held = { ...held, actionConsumed: true };
      if (id !== undefined) {
        publish();
        return;
      }
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
    return !!modalLayers.top;
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

export type ToastRuntime = typeof toast;
emit = installToastRuntime(toast);
