import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Glyph } from "./glyphs";
import { subscribe, toast, type ToastKind, type ToastState } from "./toast";
import { avoidedBars, toastBottom } from "./toastStack";
import { t as tr } from "../../i18n";

const ICON: Record<ToastKind, Parameters<typeof Glyph>[0]["name"]> = {
  info: "info",
  success: "check-circle",
  error: "alert",
  busy: "spinner",
};

export function Toaster() {
  const t = useSyncExternalStore(subscribe, () => toast.current);
  const engaged = useSyncExternalStore(subscribe, () => toast.engaged);
  const retained = useSyncExternalStore(subscribe, () => toast.retained);
  useEffect(() => {
    const endPress = () => toast.contact("press", false, toast.retained?.id ?? toast.current?.id);
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
  return [retained, t]
    .filter((value): value is ToastState => value !== null)
    .map((value) => (
      <ToastView key={value.id} t={value} suspended={value !== t} engaged={!value.blocking && engaged} />
    ));
}

function ToastView({ t, suspended, engaged }: { t: ToastState; suspended: boolean; engaged: boolean }) {
  useEffect(() => {
    if (!t.duration || engaged || suspended) return;
    const id = setTimeout(() => {
      if (!toast.engaged) toast.dismiss(t.id);
    }, t.duration);
    return () => clearTimeout(id);
  }, [t, engaged, suspended]);
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
  // Where the keyboard was before it reached the action (Tab, or a click): pressing it gives the focus back there
  // when the toast goes, unless the action moved it on (a lazy part's Retry, an Undo).
  const cameFrom = useRef<HTMLElement | null>(null);
  // One bottom-centre stack: the toast sits above the hint or the live bar instead of over them (they
  // can appear, move or resize while it shows, so it follows them).
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!t) return;
    const place = () => {
      const node = el.current;
      if (!node || suspended || (!t.blocking && (toast.engaged || document.querySelector('[aria-modal="true"]'))))
        return;
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
  }, [t, suspended]);
  if (!t) return null;
  return createPortal(
    <div
      key={t.id}
      ref={el}
      className={`ix-toast ix-toast-${t.kind}`}
      role={t.kind === "error" ? "alert" : "status"}
      aria-live={t.kind === "error" ? "assertive" : "polite"}
      data-testid="toast"
      data-kind={t.kind}
      data-toast
      data-blocking={t.blocking || undefined}
      data-suspended={suspended || undefined}
      inert={suspended}
      data-editor-overlay
      onPointerEnter={() => toast.contact("pointer", true, t.id)}
      onPointerLeave={() => toast.contact("pointer", false, t.id)}
      onPointerDownCapture={() => toast.contact("press", true, t.id)}
      onFocusCapture={() => toast.contact("focus", true, t.id)}
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
          ref={action}
          className="ix-toast-action"
          aria-disabled={t.undoUnavailable || undefined}
          aria-describedby={t.undoUnavailable ? `toast-undo-unavailable-${t.id}` : undefined}
          title={t.undoUnavailable ? tr("toast.undoUnavailable") : undefined}
          onFocus={(e) => {
            const from = e.relatedTarget;
            if (from instanceof HTMLElement && !e.currentTarget.parentElement?.contains(from)) cameFrom.current = from;
          }}
          onClick={() => {
            if (!toast.canRunAction(t.id)) return;
            const back = cameFrom.current;
            cameFrom.current = null;
            t.action!.run();
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
          className="ix-toast-close"
          onClick={() => toast.dismiss(t.id)}
          aria-label="Dismiss"
          data-testid="toast-dismiss"
        >
          <Glyph name="close" size={14} />
        </button>
      )}
    </div>,
    document.body,
  );
}
