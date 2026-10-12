import { useLayoutEffect, type RefObject } from "react";

/**
 * Focuses and selects an inline editor's field as it opens, before the next key event can arrive (F2 then
 * Esc pressed together must reach the editor, not the canvas). It selects again a frame later only if
 * something took focus back meanwhile: the menu or double-click that opened the editor may still hold it.
 */
export function useSelectOnMount(
  ref: RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
  /** "end": focus with the caret after the text (it was typed already), instead of selecting it. */
  mode: "all" | "end" = "all",
) {
  useLayoutEffect(() => {
    const place = (el: HTMLInputElement | HTMLTextAreaElement) => {
      if (mode === "all") return el.select();
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    };
    if (ref.current) place(ref.current);
    const id = requestAnimationFrame(() => {
      const el = ref.current;
      if (el && document.activeElement !== el) place(el);
    });
    return () => cancelAnimationFrame(id);
  }, [ref, mode]);
}
