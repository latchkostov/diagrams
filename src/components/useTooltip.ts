import { useEffect, useRef, useState } from "react";

/** A hoverable, focusable tooltip; a short leave delay bridges the gap between trigger and card. */
export function useTooltip() {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const open = (hovered || focused) && !dismissed;
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      setDismissed(true);
    };
    document.addEventListener("keydown", escape, true);
    return () => document.removeEventListener("keydown", escape, true);
  }, [open]);
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
