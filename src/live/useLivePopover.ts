import { useCallback, useEffect, useRef, useState } from "react";
import { useInteraction, type ElementHandle, type MenuCloseReason } from "../canvas/interaction";
import { isMac } from "../editor/shortcuts";

const platform = () => (isMac() ? "mac" : "other");

/**
 * A popover on Live's bar (its "⋯" menu, the expectations list): open and closed with a reason, both reported to the
 * interaction controller (focus policy rows M4, M5 and M6). Esc gives focus back to `invoker` when there is one; any
 * other close leaves focus where the pick or the press put it. Not one of the canvas's surfaces: opening one doesn't
 * close a canvas menu, and it doesn't hold data-interaction-state.
 */
export function useLivePopover(invoker: () => ElementHandle | null = () => null) {
  const interaction = useInteraction();
  const [open, setOpen] = useState(false);
  const live = useRef({ open: false, invoker: null as ElementHandle | null, interaction, getInvoker: invoker });
  useEffect(() => {
    live.current.interaction = interaction;
    live.current.getInvoker = invoker;
  });

  const show = useCallback((via: "pointer" | "keyboard") => {
    const l = live.current;
    if (l.open) return;
    l.open = true;
    l.invoker = l.getInvoker();
    setOpen(true);
    l.interaction?.dispatch({ type: "menu.opened", kind: "live", via, platform: platform() });
  }, []);

  const close = useCallback((reason: MenuCloseReason) => {
    const l = live.current;
    if (!l.open) return;
    l.open = false;
    setOpen(false);
    l.interaction?.dispatch({ type: "menu.closed", kind: "live", reason, invoker: l.invoker, platform: platform() });
  }, []);

  /** Its own control: opens it (by a pointer, or a key when the click has no detail), or closes it (`toggle`). */
  const toggle = useCallback(
    (e: { detail: number }) => (live.current.open ? close("toggle") : show(e.detail === 0 ? "keyboard" : "pointer")),
    [close, show],
  );

  useEffect(() => {
    const l = live.current;
    return () => {
      // The bar went away with it open (live view ended, a recording started): it closes without a word to React.
      if (!l.open) return;
      l.open = false;
      l.interaction?.dispatch({
        type: "menu.closed",
        kind: "live",
        reason: "unmount",
        invoker: null,
        platform: platform(),
      });
    };
  }, []);

  return { open, toggle, close };
}
