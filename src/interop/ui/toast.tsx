import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Glyph } from "./glyphs";

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

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

const ICON: Record<ToastKind, Parameters<typeof Glyph>[0]["name"]> = {
  info: "info",
  success: "check-circle",
  error: "alert",
  busy: "spinner",
};

export function Toaster() {
  const t = useSyncExternalStore(subscribe, () => current);
  useEffect(() => {
    if (!t || !t.duration) return;
    const id = setTimeout(() => toast.dismiss(t.id), t.duration);
    return () => clearTimeout(id);
  }, [t]);
  if (!t) return null;
  return createPortal(
    <div
      key={t.id}
      className={`ix-toast ix-toast-${t.kind}`}
      role={t.kind === "error" ? "alert" : "status"}
      aria-live={t.kind === "error" ? "assertive" : "polite"}
      data-testid="toast"
      data-kind={t.kind}
      data-editor-overlay
    >
      <span className="ix-toast-icon">
        <Glyph name={ICON[t.kind]} size={16} />
      </span>
      <span className="ix-toast-text">{t.text}</span>
      {t.action && (
        <button
          className="ix-toast-action"
          onClick={() => {
            t.action!.run();
            toast.dismiss(t.id);
          }}
          data-testid={t.action.testId ?? "toast-action"}
        >
          {t.action.label}
        </button>
      )}
      <button
        className="ix-toast-close"
        onClick={() => toast.dismiss(t.id)}
        aria-label="Dismiss"
        data-testid="toast-dismiss"
      >
        <Glyph name="close" size={14} />
      </button>
    </div>,
    document.body,
  );
}
