import { flushSync } from "react-dom";
import { deliverPendingKey, type PendingKey } from "../canvas/typeAhead";

/** DOM adapter for the controller's pending input. It ships with the menu, never its loading shell. */
export function replayMenuKey(key: PendingKey) {
  flushSync(() => {
    // Enter may have installed a held rename. Never dispatch its remaining text back into the menu.
    if (deliverPendingKey(key)) return;
    const el = document.activeElement;
    if (!el?.dispatchEvent(new KeyboardEvent("keydown", { ...key, bubbles: true, cancelable: true }))) return;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
    let start = el.selectionStart ?? 0;
    let end = el.selectionEnd ?? start;
    if ((key.ctrlKey || key.metaKey) && key.key.toLowerCase() === "a") return el.select();
    if (key.ctrlKey || key.metaKey || key.altKey) return;
    if (["Home", "End", "ArrowLeft", "ArrowRight"].includes(key.key)) {
      const backward = el.selectionDirection === "backward";
      const anchor = backward ? end : start;
      const edge = backward ? start : end;
      const caret =
        key.key === "Home"
          ? 0
          : key.key === "End"
            ? el.value.length
            : key.key === "ArrowLeft"
              ? Math.max(0, key.shiftKey ? edge - 1 : start - (start === end ? 1 : 0))
              : Math.min(el.value.length, key.shiftKey ? edge + 1 : end + (start === end ? 1 : 0));
      if (key.shiftKey)
        el.setSelectionRange(Math.min(anchor, caret), Math.max(anchor, caret), caret < anchor ? "backward" : "forward");
      else el.setSelectionRange(caret, caret);
      return;
    }
    let text = key.key.length === 1 ? key.key : "";
    if (key.key === "Backspace") {
      if (start === end) start = Math.max(0, start - 1);
    } else if (key.key === "Delete") {
      if (start === end) end = Math.min(el.value.length, end + 1);
    } else if (!text) return;
    text = el.value.slice(0, start) + text + el.value.slice(end);
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    const caret = start + (key.key.length === 1 ? key.key.length : 0);
    el.setSelectionRange(caret, caret);
  });
}
