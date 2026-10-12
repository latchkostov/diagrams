import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Glyph } from "./glyphs";
import { subscribe, toast, type ToastKind } from "./toast";
import { avoidedBars, toastBottom } from "./toastStack";

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
  // One bottom-centre stack: the toast sits above the hint or the live bar instead of over them (they
  // can appear, move or resize while it shows, so it follows them).
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!t) return;
    const place = () => {
      const node = el.current;
      if (!node) return;
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
  }, [t]);
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
