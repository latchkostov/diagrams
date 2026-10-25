// App-wide toasts. A tiny external store, so any module (not just components) can report
// progress or errors: `toast.info("Saved")`, `toast.error("...")`, `toast.busy("Rendering…")`.
// One visible toast at a time. A task holding page input owns its Cancel until it finishes;
// other notifications wait behind it (latest wins, as with ordinary toasts). An engaged toast
// likewise keeps its action until the pointer, keyboard focus and any press have left.

import { createMachine } from "../../lib/machine";
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
}

let current: ToastState | null = null;
let deferred: ToastState | null = null;
let held: ToastState | null = null;
const contact = createMachine(toastEngagement);
const blocking: ToastState[] = [];
let seq = 0;
const listeners = new Set<() => void>();
let live = new Map<number, ToastState>();
let undoHistory: { capture(): object | undefined; current(): object | undefined } | undefined;
const emit = () => listeners.forEach((l) => l());

interface ToastOptions {
  action?: ToastAction;
  duration?: number;
  blocking?: boolean;
  onDismiss?: () => void;
}

function publish() {
  const next = new Map([...blocking, deferred, held].filter((t): t is ToastState => t !== null).map((t) => [t.id, t]));
  const removed = [...live.values()].filter((t) => !next.has(t.id));
  live = next;
  current = blocking.at(-1) ?? held ?? deferred;
  for (const t of removed) t.onDismiss?.();
  emit();
}

function show(kind: ToastKind, text: string, opts: ToastOptions = {}): number {
  const history = undoHistory;
  const undoEntryId = opts.action?.undoes ? history?.capture() : undefined;
  const duration = opts.duration ?? (kind === "busy" ? 0 : kind === "error" ? 8000 : opts.action ? 6000 : 3500);
  const next = {
    id: ++seq,
    kind,
    text,
    action: opts.action?.undoes
      ? {
          ...opts.action,
          run: () => {
            if (undoEntryId && history?.current() === undoEntryId && live.get(next.id)?.undoUnavailable === false)
              opts.action!.run();
            else toast.invalidateUndo();
          },
        }
      : opts.action,
    undoEntryId,
    undoUnavailable: opts.action?.undoes ? !undoEntryId : false,
    duration,
    blocking: opts.blocking,
    onDismiss: opts.onDismiss,
  };
  if (opts.blocking) {
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
  /** Keep an engaged notification in place, but never keep an obsolete Undo alive. */
  invalidateUndo() {
    const entryId = undoHistory?.current();
    const invalidate = (t: ToastState | null): ToastState | null =>
      t?.action?.undoes && !t.undoUnavailable && t.undoEntryId !== entryId ? { ...t, undoUnavailable: true } : t;
    held = invalidate(held);
    deferred = invalidate(deferred);
    for (let i = 0; i < blocking.length; i++) blocking[i] = invalidate(blocking[i])!;
    publish();
  },
  canRunAction(id: number) {
    toast.invalidateUndo();
    const t = live.get(id);
    return !!t?.action && !t.undoUnavailable;
  },
  info: (text: string, opts?: { action?: ToastAction; duration?: number }) => show("info", text, opts),
  success: (text: string, opts?: { action?: ToastAction; duration?: number }) => show("success", text, opts),
  error: (text: string, opts?: { action?: ToastAction; duration?: number }) => show("error", text, opts),
  /** Sticky until dismissed; a long task may offer its cancel as the action and report `progress`. */
  busy: (text: string, opts?: { action?: ToastAction; blocking?: boolean }) => show("busy", text, opts),
  /** How far busy toast `id` has got (0 to 1), including an owner behind a newer task. */
  progress(id: number, done: number) {
    const at = blocking.findIndex((t) => t.id === id);
    const task = at >= 0 ? blocking[at] : deferred?.id === id ? deferred : held?.id === id ? held : null;
    if (!task || task.progress === done) return;
    if (at >= 0) blocking[at] = { ...blocking[at], progress: done };
    else if (deferred?.id === id) deferred = { ...deferred, progress: done };
    if (held?.id === id) held = { ...held, progress: done };
    publish();
  },
  /** Dismisses `id`, or ordinary notifications if omitted. Only a task's owner dismisses its blocking toast. */
  dismiss(id?: number) {
    const release = held && (held.id === id || (id === undefined && !held.blocking));
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
  },
  /** Toaster's synchronous input boundary; no timer may move or replace an engaged action. */
  contact(contactType: ToastContact, active: boolean, id = current?.id) {
    // A sticky task owns its controls independently of ordinary toast engagement.
    if (id === current?.id && current?.blocking) return;
    if (id !== current?.id && (active || id !== held?.id)) return;
    contact.send({ type: "contact", contact: contactType, active });
    held = contact.state.value === "engaged" ? (held ?? current) : null;
    publish();
  },
  release() {
    contact.send({ type: "reset" });
    held = null;
    publish();
  },
  get engaged() {
    return contact.state.value === "engaged";
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
