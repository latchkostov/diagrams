import { flushSync } from "react-dom";
import { deliverPendingKey, type PendingKey } from "../canvas/typeAhead";
import { pendingTextKey } from "./pendingText";

/** DOM adapter for the controller's pending input. It ships with the menu, never its loading shell. */
export function replayMenuKey(key: PendingKey) {
  flushSync(() => {
    // Enter may have installed a held rename. Never dispatch its remaining text back into the menu.
    if (deliverPendingKey(key)) return;
    const el = document.activeElement;
    if (!el?.dispatchEvent(new KeyboardEvent("keydown", { ...key, bubbles: true, cancelable: true }))) return;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
    const next = pendingTextKey(
      {
        value: el.value,
        start: el.selectionStart ?? 0,
        end: el.selectionEnd ?? 0,
        direction: el.selectionDirection ?? "none",
      },
      key,
      /Mac|iPhone|iPad/.test(navigator.platform),
    );
    if (next.value !== el.value) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, next.value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    el.setSelectionRange(next.start, next.end, next.direction);
  });
}
