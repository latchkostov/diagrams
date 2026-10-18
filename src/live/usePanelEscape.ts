import { useEffect, useLayoutEffect, useRef } from "react";
import { domActive, PANEL_OPENER_ATTR, useInteraction } from "../canvas/interaction";

/** Marks the live bar control that opens side panels, so focus has somewhere to return. */
export { PANEL_OPENER_ATTR };

/**
 * Esc closes a live side panel (it is one of live view's Esc owners, so live view waits for it).
 * `back` handles a nested level first (cancel a node picker, leave a sub-view) and returns true when
 * it did. Menus and dialogs above the panel get their Esc first. Focus returns to the control that
 * opened the panel (focus policy row D2, through the interaction controller), so a second Esc can leave live view.
 */
export function usePanelEscape(onClose: () => void, back?: () => boolean) {
  const interaction = useInteraction();
  const ref = useRef({ onClose, back, interaction });
  useLayoutEffect(() => {
    ref.current = { onClose, back, interaction };
    // Each commit of the panel: a field waiting for it to list a new row (row L4) is tried again.
    interaction?.rendered();
  });
  useEffect(() => {
    const opener = domActive();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[role="menu"], [role="dialog"]')) return;
      e.preventDefault();
      e.stopPropagation();
      if (ref.current.back?.()) return;
      ref.current.onClose();
      ref.current.interaction?.dispatch({ type: "dialog.closed", dialog: "livePanel", opener, reason: "escape" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
