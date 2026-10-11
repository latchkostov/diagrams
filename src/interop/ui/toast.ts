// App-wide toasts. A tiny external store, so any module (not just components) can report
// progress or errors: `toast.info("Saved")`, `toast.error("...")`, `toast.busy("Rendering…")`.
// One toast at a time: a new message replaces the current one.

export type ToastKind = "info" | "success" | "error" | "busy";

export interface ToastAction {
  label: string;
  run: () => void;
  testId?: string;
}

export interface ToastState {
  id: number;
  kind: ToastKind;
  text: string;
  action?: ToastAction;
  /** ms; 0 = sticky until replaced or dismissed. */
  duration: number;
}

let current: ToastState | null = null;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function show(kind: ToastKind, text: string, opts: { action?: ToastAction; duration?: number } = {}): number {
  const duration = opts.duration ?? (kind === "busy" ? 0 : kind === "error" ? 8000 : opts.action ? 6000 : 3500);
  current = { id: ++seq, kind, text, action: opts.action, duration };
  emit();
  return current.id;
}

export const toast = {
  info: (text: string, opts?: { action?: ToastAction; duration?: number }) => show("info", text, opts),
  success: (text: string, opts?: { action?: ToastAction; duration?: number }) => show("success", text, opts),
  error: (text: string, opts?: { action?: ToastAction; duration?: number }) => show("error", text, opts),
  busy: (text: string) => show("busy", text),
  /** Dismisses the current toast, or only toast `id` if given (so a finished task doesn't clear a newer message). */
  dismiss(id?: number) {
    if (!current || (id !== undefined && current.id !== id)) return;
    current = null;
    emit();
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
