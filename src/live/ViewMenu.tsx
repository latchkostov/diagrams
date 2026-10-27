import { useEffect, useRef, useSyncExternalStore } from "react";
import { useStore } from "@xyflow/react";
import { useCameraController } from "../canvas/camera/useCameraCore";
import { t, useLocale } from "../i18n";
import { useLivePopover } from "./useLivePopover";

export function ViewMenu() {
  useLocale();
  const camera = useCameraController();
  const view = useSyncExternalStore(camera?.subscribe ?? (() => () => {}), () => camera?.state.view ?? "overview");
  const zoom = useStore((s) => s.transform[2]);
  const trigger = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const { open, toggle, close } = useLivePopover(() => trigger.current);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close("outside");
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") close("escape");
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", esc);
    };
  }, [open, close]);
  const label =
    view === "follow"
      ? t("camera.following")
      : view === "focus"
        ? t("camera.focus")
        : view === "custom"
          ? t("camera.custom")
          : t("camera.overview");
  const pick = (action: () => void) => {
    close("command");
    action();
  };
  return (
    <div ref={root} className="lv-view">
      <button
        ref={trigger}
        type="button"
        className="lv-btn"
        data-testid="live-view-menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        {view === "follow" && <i className="lv-follow-dot" />}
        <span>
          {label} · {Math.round(zoom * 100)}%
        </span>
      </button>
      {open && (
        <div className="lv-more-menu" role="menu" data-testid="live-view-options">
          <button
            role="menuitem"
            data-testid="fit-view-button"
            onClick={() => pick(() => camera?.dispatch({ type: "view.requested", view: "overview" }))}
          >
            <span data-testid="view-overview">{t("camera.overview")}</span>
            <kbd>⇧1</kbd>
          </button>
          <button
            role="menuitem"
            data-testid="view-focus"
            onClick={() => pick(() => camera?.dispatch({ type: "view.requested", view: "focus" }))}
          >
            {t("camera.focus")}
            <kbd>⇧2</kbd>
          </button>
          <button
            role="menuitem"
            data-testid="view-follow"
            onClick={() => pick(() => camera?.dispatch({ type: "view.requested", view: "follow" }))}
          >
            {t("camera.follow")}
            <kbd>⇧3</kbd>
          </button>
          <button
            role="menuitem"
            data-testid="zoom-in-button"
            onClick={() => pick(() => camera?.dispatch({ type: "zoom.step", direction: 1 }))}
          >
            {t("chrome.zoomIn")}
          </button>
          <button
            role="menuitem"
            data-testid="zoom-out-button"
            onClick={() => pick(() => camera?.dispatch({ type: "zoom.step", direction: -1 }))}
          >
            {t("chrome.zoomOut")}
          </button>
          <button
            role="menuitem"
            data-testid="zoom-100"
            onClick={() => pick(() => camera?.dispatch({ type: "zoom100" }))}
          >
            {t("shortcuts.zoom100")}
          </button>
        </div>
      )}
    </div>
  );
}
