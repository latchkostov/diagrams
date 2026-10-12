import { useLayoutEffect, type RefObject } from "react";

/**
 * Focuses and selects an inline editor's field as it opens, before the next key event can arrive (F2 then
 * Esc pressed together must reach the editor, not the canvas). It selects again a frame later only if
 * something took focus back meanwhile: the menu or double-click that opened the editor may still hold it.
 */
export function useSelectOnMount(ref: RefObject<HTMLInputElement | HTMLTextAreaElement | null>) {
  useLayoutEffect(() => {
    ref.current?.select();
    const id = requestAnimationFrame(() => {
      const el = ref.current;
      if (el && document.activeElement !== el) el.select();
    });
    return () => cancelAnimationFrame(id);
  }, [ref]);
}
