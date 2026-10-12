import { useEffect, type RefObject } from "react";
import { isEditableTarget } from "../editor/shortcuts";

/**
 * The drawing (nodes, edges, labels, icons, handles), not the panels floating over it, minus anything meant
 * for text: an open inline editor's field, or an overlay such as the event log.
 */
function onDrawing(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  return !!el?.closest(".react-flow__renderer") && !isEditableTarget(el) && !el.closest("[data-editor-overlay]");
}

/**
 * Backstop for "App, not page" on the canvas. The root fix is CSS: nothing on the drawing is user-selectable
 * (styles/app.css). This makes sure no text selection survives or starts with a canvas gesture anyway:
 *  - a press on the drawing (connect drag, node drag, box select, pan) clears any selection left over from
 *    a panel, a search field or an inline editor, so it can't extend over nodes or keep Ctrl+C copying text
 *    instead of the selected nodes (useCanvasShortcuts skips copy while text is selected);
 *  - a selection that would start on the drawing is cancelled.
 * Text fields (inline editors) and overlays are left alone, so their text stays selectable.
 */
export function useNoCanvasTextSelection(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!onDrawing(e.target)) return;
      const sel = window.getSelection();
      if (sel?.rangeCount) sel.removeAllRanges();
    };
    const onSelectStart = (e: Event) => {
      if (onDrawing(e.target)) e.preventDefault();
    };
    el.addEventListener("pointerdown", onPointerDown, true);
    el.addEventListener("selectstart", onSelectStart, true);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown, true);
      el.removeEventListener("selectstart", onSelectStart, true);
    };
  }, [ref]);
}
