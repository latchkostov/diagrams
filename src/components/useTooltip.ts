import { useEffect, useRef, useState } from "react";

// Modified navigation keys do not always set the browser's :focus-visible heuristic.
// Track input modality once for all detail readers, rather than attaching key listeners per edge/node.
let readers = 0,
  keyboardInput = false;
const keyboard = () => {
  keyboardInput = true;
};
const pointer = () => {
  keyboardInput = false;
};

/**
 * True while the element `selector` names has keyboard focus, including modified navigation. The canvas is one Tab stop
 * (D14), so controls inside a node or on an edge aren't Tab stops: their details open when the node or edge
 * itself is reached from the keyboard. Null: nothing to watch.
 */
export function useKeyboardFocusOn(selector: string | null): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!selector) return;
    if (readers++ === 0) {
      document.addEventListener("keydown", keyboard, true);
      document.addEventListener("pointerdown", pointer, true);
    }
    const check = () => {
      const el = document.activeElement;
      setOn(!!el && el.matches(selector) && (el.matches(":focus-visible") || keyboardInput));
    };
    check();
    document.addEventListener("focusin", check);
    document.addEventListener("focusout", check);
    return () => {
      document.removeEventListener("focusin", check);
      document.removeEventListener("focusout", check);
      if (--readers === 0) {
        document.removeEventListener("keydown", keyboard, true);
        document.removeEventListener("pointerdown", pointer, true);
      }
      setOn(false);
    };
  }, [selector]);
  return on;
}

/**
 * A hoverable, focusable tooltip; a short leave delay bridges the gap between trigger and card. `shown`: also
 * open (the node or edge it belongs to has keyboard focus).
 */
export function useTooltip(shown = false, dismissible = true) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const open = (hovered || focused || shown) && !dismissed;
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open || !dismissible) return;
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      setDismissed(true);
    };
    document.addEventListener("keydown", escape, true);
    return () => document.removeEventListener("keydown", escape, true);
  }, [open, dismissible]);
  const pointer = {
    onPointerEnter: () => {
      clearTimeout(timer.current);
      setHovered(true);
      setDismissed(false);
    },
    onPointerLeave: () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setHovered(false), 150);
    },
  };
  return {
    open,
    pointer,
    trigger: {
      ...pointer,
      onFocus: () => {
        setFocused(true);
        setDismissed(false);
      },
      onBlur: () => setFocused(false),
    },
  };
}
