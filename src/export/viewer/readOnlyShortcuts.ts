import { useEffect, useLayoutEffect, useRef } from "react";
import { isEditableTarget, shortcutFor } from "../../editor/shortcuts";
import { onCanvasItem } from "../../editor/canvasKeyTarget";
export { inCanvas } from "../../editor/canvasKeyTarget";
import type { useCanvasShortcuts as useEditingShortcuts } from "../../editor/useCanvasShortcuts";
/** The file retains Live's Tab navigation; authoring and clipboard shortcuts never install. */
export function useCanvasShortcuts(
  _editor: Parameters<typeof useEditingShortcuts>[0],
  opts: Parameters<typeof useEditingShortcuts>[1],
) {
  const optsRef = useRef(opts);
  useLayoutEffect(() => {
    optsRef.current = opts;
  }, [opts]);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || isEditableTarget(e.target)) return;
      if (e.target instanceof Element && e.target.closest("[data-editor-overlay]")) return;
      const id = shortcutFor(e);
      const handled = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (id === "select-next" || id === "select-prev") {
        if (!optsRef.current.enabled && !optsRef.current.live) return;
        // Tab steps between nodes only from a node, an edge or the canvas; elsewhere it's the page's.
        const nav = optsRef.current.onNavigate;
        if (!nav || !onCanvasItem(e.target)) return;
        // Enter an annotation's link surface before stepping to the next canvas item.
        // This runs in window capture, before any link's own keyboard handler.
        const node = (e.target as Element).closest<HTMLElement>(".react-flow__node");
        const links = Array.from(node?.querySelectorAll<HTMLAnchorElement>("[data-caption-root] a[href]") ?? []);
        const current = links.indexOf(e.target as HTMLAnchorElement);
        const backwards = id === "select-prev";
        const next =
          current >= 0 ? (links[current + (backwards ? -1 : 1)] ?? (backwards ? node : null)) : !backwards && links[0];
        if (next) {
          handled();
          next.focus();
        } else if (nav(backwards ? "prev" : "next", e.target)) handled();
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
}
