import { useEffect, type RefObject } from "react";
import { handleMarkdownKeyDown } from "../../components/markdown/markdownKeys";

/** Enhance the mounted textarea without owning its value, focus, caret or selection. */
export function AnnotationFormatting({
  textarea,
  onChange,
}: {
  textarea: RefObject<HTMLTextAreaElement | null>;
  onChange: (value: string) => void;
}) {
  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    const onKey = (event: globalThis.KeyboardEvent) => handleMarkdownKeyDown(event, el, el.value, onChange);
    el.addEventListener("keydown", onKey);
    el.setAttribute("data-markdown-ready", "");
    return () => {
      el.removeEventListener("keydown", onKey);
      el.removeAttribute("data-markdown-ready");
    };
  }, [textarea, onChange]);
  return null;
}
