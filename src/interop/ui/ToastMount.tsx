import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { lazyComponent, LOAD_FAILED } from "../../lib/lazyLoad";
import { modalLayers } from "../../lib/modalLayers";
import { inputHeld } from "../../lib/inputHold";
import { loadToastRenderer, subscribe, toast } from "./toast";
import { t } from "../../i18n";

const onModal = (listener: () => void) => {
  modalLayers.listeners.add(listener);
  return () => void modalLayers.listeners.delete(listener);
};

/**
 * A failed renderer's Retry, under the toasts' own layer rules (docs/design-review/2026-10-25-toast-layering.md): in
 * the open dialog's feedback slot, so in its Tab cycle; on the page otherwise, stepping back under a modal without a
 * slot. It is a toast (`data-toast`), so a task holding the page's input lets it through, and it takes the keyboard
 * there, as the task's own Cancel would have.
 */
function Recovery({ retry }: { retry(): void }) {
  const slot = useSyncExternalStore(onModal, () => modalLayers.top?.feedback ?? null);
  const button = useRef<HTMLButtonElement>(null);
  const node = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (inputHeld()) button.current?.focus();
  }, []);
  // Placed as the Toaster places a dialog's feedback (feedbackPlacement in toastFeedback.ts, deferred with it), before it
  // paints: below the panel, or, in a short window, inside it with the panel's height kept, so it is in reach and the
  // dialog's own controls stay where they were.
  useLayoutEffect(() => {
    const el = node.current;
    const panel = el?.closest<HTMLElement>('[role="dialog"]');
    if (el?.dataset.place !== "below" || !panel) return;
    const box = panel.getBoundingClientRect();
    if (innerHeight - box.bottom >= el.offsetHeight + 20) return;
    const height = panel.style.height;
    panel.style.height = `${box.height}px`;
    el.dataset.place = "inside";
    return () => {
      panel.style.height = height;
      // StrictMode replays this setup on the same node. Restore its starting placement too,
      // so the next setup measures the panel without the inline feedback and pins it again.
      el.dataset.place = "below";
    };
  }, [slot]);
  const view = (
    <div
      ref={node}
      className="ix-toast ix-toast-error"
      role="alert"
      data-testid="toast-load-error"
      data-toast
      data-layer={slot ? "dialog" : "page"}
      data-place={slot && (slot.dataset.feedback === "inline" ? "inside" : "below")}
      data-editor-overlay
    >
      {LOAD_FAILED}
      <button
        type="button"
        ref={button}
        className="ix-toast-action"
        onClick={(e) => {
          // It goes as the download starts again: a dialog keeps the keyboard (its Tab cycle and Escape).
          e.currentTarget.closest<HTMLElement>('[role="dialog"]')?.focus();
          retry();
        }}
        data-testid="toast-load-retry"
      >
        {t("common.retry")}
      </button>
    </div>
  );
  return slot ? createPortal(view, slot) : <div data-toast-layer="page">{view}</div>;
}

// The store is synchronous even before this renderer downloads: Undo binds at the edit, not on arrival.
// Recovery must ship outside that renderer too, since a failed Toaster cannot show its own failure toast.
const Renderer = lazyComponent(loadToastRenderer, (_props, { failed, retry }) =>
  failed ? <Recovery retry={retry} /> : null,
);

export function ToastMount() {
  const needed = useSyncExternalStore(subscribe, () => toast.started);
  return needed ? <Renderer /> : null;
}
