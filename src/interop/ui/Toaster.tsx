import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Glyph } from "./glyphs";
import { subscribe, toast, type ToastKind } from "./toast";

const ICON: Record<ToastKind, Parameters<typeof Glyph>[0]["name"]> = {
  info: "info",
  success: "check-circle",
  error: "alert",
  busy: "spinner",
};

export function Toaster() {
  const t = useSyncExternalStore(subscribe, () => toast.current);
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
