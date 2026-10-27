// Synchronous notification ingress. The renderer and its interaction store download on first use.
// Capture ids and Undo ownership here; replay input in order, without waiting on a network clock.
import { modalLayers, type ModalLayer } from "../../lib/modalLayers";
import type { ToastRuntime } from "./toastRuntime";
import { loadOnce } from "../../lib/lazyLoad";

export const loadToastRenderer = loadOnce(() => import("./Toaster").then((m) => m.Toaster));

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
  /** The action completed; its control may still be retained as a modal's focus-return target. */
  actionConsumed?: boolean;
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

let runtime: ToastRuntime | undefined;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
type Command = "show" | "invalidateUndo" | "attach" | "progress" | "dismiss" | "dismissUndo";
const queued: [Command, unknown[]][] = [];
/** The last queued invalidation, while no notification has been queued after it. */
let invalidation: unknown[] | undefined;

function send<K extends Command>(method: K, ...args: Parameters<ToastRuntime[K]>) {
  // Each command keeps its input at the time of the call (not the state when the download completes).
  if (runtime) return (runtime[method] as (...args: unknown[]) => void)(...args);
  if (!queued.length && method !== "show") return;
  // Compact while waiting, however long the download takes: every canvas snapshot invalidates, a task reports often.
  // An invalidation joins the last one unless a notification came between (it commutes with everything else):
  // pending changes nothing, and two different entries leave no bound Undo standing, as a fresh one does.
  if (method === "invalidateUndo") {
    if (args[0] === HISTORY_PENDING) return;
    if (invalidation) return void (invalidation[0] !== args[0] && (invalidation[0] = {}));
    invalidation = args;
  }
  if (method === "show") invalidation = undefined;
  const progress = method === "progress" && queued.find(([m, a]) => m === method && a[0] === args[0]);
  if (progress) progress[1] = args;
  else queued.push([method, args]);
}

export function installToastRuntime(store: ToastRuntime) {
  runtime = store;
  // Replay without publishing partial snapshots to mounted clients.
  for (const [method, args] of queued.splice(0)) send(method, ...(args as [never]));
  invalidation = undefined;
  emit();
  return emit;
}

type NoticeOptions = Pick<ToastOptions, "action" | "duration">;
interface ToastOptions {
  action?: ToastAction;
  duration?: number;
  blocking?: boolean;
  onDismiss?: () => void;
}

export interface ToastInput extends ToastOptions {
  id: number;
  kind: ToastKind;
  text: string;
  layer?: number;
  history?: NonNullable<typeof undoHistory>;
  undoEntryId?: object;
}

function show(kind: ToastKind, text: string, opts: ToastOptions = {}): number {
  const history = opts.action?.undoes ? undoHistory : undefined;
  const next: ToastInput = {
    ...opts,
    id: ++seq,
    kind,
    text,
    history,
    undoEntryId: history?.capture(),
    layer: opts.blocking ? undefined : modalLayers.top?.id,
  };
  send("show", next);
  void loadToastRenderer().catch(() => {});
  emit();
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
  invalidateUndo(settle = false) {
    send("invalidateUndo", settle ? undoHistory?.capture() : undoHistory?.current());
  },
  info: (text: string, opts?: NoticeOptions) => show("info", text, opts),
  success: (text: string, opts?: NoticeOptions) => show("success", text, opts),
  error: (text: string, opts?: NoticeOptions) => show("error", text, opts),
  busy: (text: string, opts?: { action?: ToastAction; blocking?: boolean }) => show("busy", text, opts),
  progress: (id: number, done: number) => send("progress", id, done),
  /**
   * Gives notification `id` an action found later (its code loaded after it showed), wherever it is by then: shown,
   * retained, waiting behind a dialog or a download. Nothing, once it has gone.
   */
  attach: (id: number, action: ToastAction) => send("attach", id, action),
  dismiss(id?: number) {
    send("dismiss", id);
    emit();
  },
  dismissUndo: () => send("dismissUndo"),
  /** Keep the renderer mounted after first use, including between notifications and modal handoffs. */
  get started() {
    return seq > 0;
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

export function notify(text: string, opts: NotifyOptions = {}): number {
  return show(opts.kind ?? "info", text, opts);
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
