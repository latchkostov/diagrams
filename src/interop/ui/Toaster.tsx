import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal, flushSync } from "react-dom";
import { Glyph } from "./glyphs";
import { subscribe, type ToastKind, type ToastState } from "./toast";
import { toast } from "./toastRuntime";
import { avoidedBars, toastBottom } from "./toastStack";
import { feedbackPlacement } from "./toastFeedback";
import { modalLayers, type ModalLayer } from "../../lib/modalLayers";
import { t as tr } from "../../i18n";

const ICON: Record<ToastKind, Parameters<typeof Glyph>[0]["name"]> = {
  info: "info",
  success: "check-circle",
  error: "alert",
  busy: "spinner",
};

/**
 * The toasts' layers (docs/design-review/2026-10-25-toast-layering.md): the page's notifications, in one page-layer
 * root under every menu and modal; each open dialog's own feedback, portalled into that dialog's feedback slot; and
 * a task's progress and Cancel, portalled to the body above everything, as the task holds the page's input.
 *
 * The page-layer root lives in the Workbench (or the body in viewers), so every modal's background sweep makes it inert as it opens and
 * restores it as it closes, in the same synchronous step as the modal hands the focus back (which may be to a
 * toast's action). Inert, its notifications are hidden too (interop.css): they keep their rectangle, out of reach.
 */
export function Toaster() {
  const t = useSyncExternalStore(subscribe, () => toast.current);
  const engaged = useSyncExternalStore(subscribe, () => toast.engaged);
  const retained = useSyncExternalStore(subscribe, () => toast.retained);
  const steppedBack = useSyncExternalStore(subscribe, () => toast.steppedBack);
  const layered = useSyncExternalStore(subscribe, () => toast.layered);
  const openerToasts = new Set(
    modalLayers.stack
      .flatMap((l) => (l.opener ? [l.opener] : []))
      .map((el) => Number(el.closest<HTMLElement>("[data-toast-id]")?.dataset.toastId)),
  );
  // One root for the Toaster's lifetime. Rendered to markup (no DOM to make it in), the body stands in.
  const [pageRoot] = useState(() => {
    if (typeof document.createElement !== "function") return null;
    const root = document.createElement("div");
    root.dataset.toastLayer = "page";
    return root;
  });
  useLayoutEffect(() => {
    if (!pageRoot) return;
    const host = document.querySelector("[data-toast-host]") ?? document.body;
    if (pageRoot.parentElement !== host) host.append(pageRoot);
  });
  useLayoutEffect(() => () => pageRoot?.remove(), [pageRoot]);
  useEffect(() => {
    const endPress = () => toast.endPress();
    window.addEventListener("pointerup", endPress);
    window.addEventListener("pointercancel", endPress);
    window.addEventListener("blur", endPress);
    return () => {
      window.removeEventListener("pointerup", endPress);
      window.removeEventListener("pointercancel", endPress);
      window.removeEventListener("blur", endPress);
      toast.release();
    };
  }, []);
  return (
    <>
      {[retained, t]
        // Under an open modal the page's notifications step back. One that is engaged, or that a modal was opened
        // from, stays mounted (hidden, inert, its rectangle kept, so the modal can hand the focus back to it); any
        // other waits in the store, its expiry paused, and is shown and announced afresh when the modal closes.
        .filter(
          (value): value is ToastState =>
            value !== null && (value.blocking || !steppedBack || engaged || openerToasts.has(value.id)),
        )
        .map((value) => (
          <ToastView
            key={value.id}
            t={value}
            host={value.blocking ? document.body : (pageRoot ?? document.body)}
            suspended={value !== t}
            paused={!value.blocking && steppedBack}
            engaged={!value.blocking && engaged}
          />
        ))}
      {layered.map(({ layer, toast: value, engaged }) => (
        <ToastView
          key={value.id}
          t={value}
          host={layer.feedback}
          layer={layer}
          suspended={false}
          paused={false}
          engaged={engaged}
        />
      ))}
    </>
  );
}

function ToastView({
  t,
  host,
  suspended,
  paused,
  engaged,
  layer,
}: {
  t: ToastState;
  host: HTMLElement | null;
  /** Behind a task's toast: hidden and inert, its rectangle kept. */
  suspended: boolean;
  /** Stepped back under a modal: neither expires nor moves. */
  paused: boolean;
  engaged: boolean;
  /** The open dialog this toast is feedback for; absent for the page's notifications and tasks. */
  layer?: ModalLayer;
}) {
  useEffect(() => {
    if (!t.duration || engaged || suspended || paused) return;
    const id = setTimeout(() => {
      if (!toast.engagedFor(t.id)) toast.dismiss(t.id);
    }, t.duration);
    return () => clearTimeout(id);
  }, [t, engaged, suspended, paused]);
  // An action that asks for the focus (a long task's Cancel) takes it from wherever it was, and gives it back.
  const action = useRef<HTMLButtonElement>(null);
  const focusAction = !!t?.action?.focus;
  const toastId = t?.id;
  // After the effects of the same commit: a dialog closing as the toast shows gives its opener the focus back first.
  useEffect(() => {
    if (!focusAction) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const button = action.current;
    button?.focus();
    return () => {
      const now = document.activeElement;
      if (before?.isConnected && (!now || now === document.body || now === button)) before.focus();
    };
  }, [focusAction, toastId]);
  // Where the keyboard was before it reached the toast (Tab, or a click): pressing the action gives the focus back
  // there when the toast goes, unless the action moved it on (a lazy part's Retry, an Undo); so does Dismiss.
  const cameFrom = useRef<HTMLElement | null>(null);
  // One bottom-centre stack: the toast sits above the hint or the live bar instead of over them (they
  // can appear, move or resize while it shows, so it follows them).
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (layer) return;
    const place = () => {
      const node = el.current;
      if (!node?.isConnected || suspended || paused || (!t.blocking && toast.engaged)) return;
      // Centred on the canvas pane, not the window: with side panels open the window's centre is near
      // the pane's edge, and the toast reached over the AI panel and the minimap.
      const area = document.querySelector<HTMLElement>("[data-toast-area]")?.getBoundingClientRect();
      const fits = area && area.width >= 320;
      node.style.left = fits ? `${Math.round(area.left + area.width / 2)}px` : "";
      node.style.maxWidth = fits ? `${Math.round(area.width - 32)}px` : "";
      const r = node.getBoundingClientRect();
      node.style.bottom = `${toastBottom(r, avoidedBars(), window.innerHeight)}px`;
    };
    place();
    const id = setInterval(place, 250);
    window.addEventListener("resize", place);
    return () => {
      clearInterval(id);
      window.removeEventListener("resize", place);
    };
  }, [t, suspended, paused, layer]);
  // A dialog's feedback is placed once, before it paints (and again only when the window resizes while nothing
  // engages it): below the panel, or inside it with the panel's height kept (toastStack.ts).
  const inDialog = !!layer;
  useLayoutEffect(() => {
    const node = el.current;
    const panel = node?.closest<HTMLElement>('[role="dialog"]');
    if (!inDialog || !node || !panel) return;
    let pinned: string | null = null;
    const unpin = () => {
      if (pinned !== null) panel.style.height = pinned;
      pinned = null;
    };
    // A modal anchored at its top (the inject frame) takes its feedback as its last row: it grows downward.
    const inline = node.parentElement?.dataset.feedback === "inline";
    const place = () => {
      if (inline) return void (node.dataset.place = "inside");
      if (toast.engagedFor(toastId)) return;
      node.dataset.place = "below";
      unpin();
      const where = feedbackPlacement(panel.getBoundingClientRect(), node.offsetHeight, window.innerHeight);
      if (where === "inside") {
        pinned = panel.style.height;
        panel.style.height = `${panel.getBoundingClientRect().height}px`;
      }
      node.dataset.place = where;
    };
    place();
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("resize", place);
      unpin();
    };
  }, [inDialog, toastId]);
  if (!t || !host) return null;
  return createPortal(
    <div
      key={t.id}
      ref={el}
      className={`ix-toast ix-toast-${t.kind}`}
      role={t.kind === "error" ? "alert" : "status"}
      aria-live={t.kind === "error" ? "assertive" : "polite"}
      data-testid="toast"
      data-toast-id={t.id}
      data-kind={t.kind}
      data-toast
      data-layer={layer ? "dialog" : "page"}
      data-blocking={t.blocking || undefined}
      data-suspended={suspended || undefined}
      inert={suspended}
      data-editor-overlay
      onPointerEnter={() => toast.contact("pointer", true, t.id)}
      onPointerLeave={() => toast.contact("pointer", false, t.id)}
      onPointerDownCapture={() => toast.contact("press", true, t.id)}
      onFocusCapture={(e) => {
        const from = e.relatedTarget;
        if (from instanceof HTMLElement && !e.currentTarget.contains(from)) cameFrom.current = from;
        toast.contact("focus", true, t.id);
      }}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) toast.contact("focus", false, t.id);
      }}
    >
      {(t.kind !== "busy" || t.progress === undefined) && (
        <span className="ix-toast-icon" data-testid="toast-icon">
          <Glyph name={ICON[t.kind]} size={16} />
        </span>
      )}
      <span className="ix-toast-text">{t.text}</span>
      {t.progress !== undefined && (
        <span
          className="ix-toast-progress"
          role="progressbar"
          aria-label={t.text}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(t.progress * 100)}
          data-testid="toast-progress"
        >
          <span style={{ width: `${Math.round(t.progress * 100)}%` }} />
        </span>
      )}
      {t.action && (
        <button
          type="button"
          ref={action}
          className="ix-toast-action"
          aria-disabled={t.undoUnavailable || t.actionConsumed || undefined}
          aria-describedby={t.undoUnavailable ? `toast-undo-unavailable-${t.id}` : undefined}
          title={t.undoUnavailable ? tr("toast.undoUnavailable") : undefined}
          onClick={() => {
            if (!toast.canRunAction(t.id)) return;
            const back = cameFrom.current;
            cameFrom.current = null;
            // Register a modal opened by the action before requesting dismissal of its opener.
            flushSync(() => t.action!.run());
            if (!t.blocking) toast.dismiss(t.id);
            if (back && !focusAction)
              requestAnimationFrame(() => {
                const now = document.activeElement;
                if (back.isConnected && (!now || now === document.body)) back.focus();
              });
          }}
          data-testid={t.action.testId ?? "toast-action"}
        >
          {t.action.label}
        </button>
      )}
      {t.undoUnavailable && (
        <span className="sr-only" id={`toast-undo-unavailable-${t.id}`} data-testid="toast-undo-unavailable">
          {tr("toast.undoUnavailable")}
        </span>
      )}
      {!t.blocking && (
        <button
          type="button"
          className="ix-toast-close"
          onClick={(e) => {
            // Before it goes: the keyboard returns to where it came from, or to the dialog this toast was in,
            // so a dialog keeps its Tab cycle and Escape.
            const back = cameFrom.current;
            cameFrom.current = null;
            if (e.currentTarget.contains(document.activeElement))
              (back?.isConnected ? back : e.currentTarget.closest<HTMLElement>('[role="dialog"]'))?.focus();
            toast.dismiss(t.id);
          }}
          aria-label="Dismiss"
          data-testid="toast-dismiss"
        >
          <Glyph name="close" size={14} />
        </button>
      )}
    </div>,
    host,
  );
}
