// App-wide toasts. A tiny external store, so any module (not just components) can report
// progress or errors: `toast.info("Saved")`, `toast.error("...")`, `toast.busy("Rendering…")`.
// One visible toast at a time. A task holding page input owns its Cancel until it finishes;
// other notifications wait behind it (latest wins, as with ordinary toasts).

export type ToastKind = "info" | "success" | "error" | "busy";

export interface ToastAction {
  label: string;
  run: () => void;
  testId?: string;
  /** Takes the keyboard focus when it shows (a long task's Cancel), and gives it back when the toast goes. */
  focus?: boolean;
  /**
   * The action is the editor's Undo for the change the toast reports. Such a toast goes as soon as anything else
   * undoes or redoes (Ctrl+Z, the canvas's Undo): its button would then reverse a different change.
   */
  undoes?: boolean;
}

export interface ToastState {
  id: number;
  kind: ToastKind;
  text: string;
  action?: ToastAction;
  /** ms; 0 = sticky until replaced or dismissed. */
  duration: number;
  /** A busy task's share done (0 to 1), once it reports one. */
  progress?: number;
  /** Owns the toast until the task dismisses it; other notifications cannot hide Cancel. */
  blocking?: boolean;
}

let current: ToastState | null = null;
let deferred: ToastState | null = null;
const blocking: ToastState[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

interface ToastOptions {
  action?: ToastAction;
  duration?: number;
  blocking?: boolean;
}

function publish() {
  current = blocking.at(-1) ?? deferred;
  emit();
}

function show(kind: ToastKind, text: string, opts: ToastOptions = {}): number {
  const duration = opts.duration ?? (kind === "busy" ? 0 : kind === "error" ? 8000 : opts.action ? 6000 : 3500);
  const next = { id: ++seq, kind, text, action: opts.action, duration, blocking: opts.blocking };
  if (opts.blocking) {
    if (!blocking.length) deferred = null;
    blocking.push(next);
  } else deferred = next;
  publish();
  return next.id;
}

export const toast = {
  info: (text: string, opts?: { action?: ToastAction; duration?: number }) => show("info", text, opts),
  success: (text: string, opts?: { action?: ToastAction; duration?: number }) => show("success", text, opts),
  error: (text: string, opts?: { action?: ToastAction; duration?: number }) => show("error", text, opts),
  /** Sticky until dismissed; a long task may offer its cancel as the action and report `progress`. */
  busy: (text: string, opts?: { action?: ToastAction; blocking?: boolean }) => show("busy", text, opts),
  /** How far busy toast `id` has got (0 to 1), including an owner behind a newer task. */
  progress(id: number, done: number) {
    const at = blocking.findIndex((t) => t.id === id);
    const task = at >= 0 ? blocking[at] : deferred?.id === id ? deferred : null;
    if (!task || task.progress === done) return;
    if (at >= 0) blocking[at] = { ...blocking[at], progress: done };
    else if (deferred?.id === id) deferred = { ...deferred, progress: done };
    else return;
    publish();
  },
  /** Dismisses `id`, or ordinary notifications if omitted. Only a task's owner dismisses its blocking toast. */
  dismiss(id?: number) {
    const at = blocking.findIndex((t) => t.id === id);
    if (at >= 0) blocking.splice(at, 1);
    else if (id === undefined || deferred?.id === id) deferred = null;
    else return;
    publish();
  },
  /** Removes an ordinary Undo toast, visible or waiting: history just moved under it. */
  dismissUndo() {
    if (deferred?.action?.undoes) toast.dismiss(deferred.id);
  },
  get current() {
    return current;
  },
};

export interface NotifyOptions {
  kind?: ToastKind;
  /** One optional button, e.g. `{ label: "Undo", run: undo }`. */
  action?: ToastAction;
  /** ms; default depends on kind (errors linger, busy is sticky). */
  duration?: number;
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
