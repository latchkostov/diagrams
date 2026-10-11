import { useEffect, useLayoutEffect, useRef } from "react";

/** Marks the live bar control that opens side panels, so focus has somewhere to return. */
export const PANEL_OPENER_ATTR = "data-live-panel-opener";

/**
 * Esc closes a live side panel (it is one of LiveView's ESC_OWNERS, so live view waits for it).
 * `back` handles a nested level first (cancel a node picker, leave a sub-view) and returns true when
 * it did. Menus and dialogs above the panel get their Esc first. Focus returns to the control that
 * opened the panel, so a second Esc can leave live view.
 */
export function usePanelEscape(onClose: () => void, back?: () => boolean) {
  const ref = useRef({ onClose, back });
  useLayoutEffect(() => {
    ref.current = { onClose, back };
  });
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[role="menu"], [role="dialog"]')) return;
      e.preventDefault();
      e.stopPropagation();
      if (ref.current.back?.()) return;
      ref.current.onClose();
      const target =
        opener?.isConnected && opener !== document.body
          ? opener
          : document.querySelector<HTMLElement>(`[${PANEL_OPENER_ATTR}]`);
      target?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
