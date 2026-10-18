import type { MenusEvent, MenusState, MenusTransition, SurfaceKind } from "./types";

/**
 * The menus' lifecycle, as one pure function: one surface at a time, opened with what had focus, closed with a
 * reason. The controller (controller.ts) runs it and tells the camera and the focus policy what happened.
 *
 * | Row | Event                 | Condition                         | State / reported                               |
 * | --- | --------------------- | --------------------------------- | ---------------------------------------------- |
 * | O1  | menu.open             | nothing open                      | open := it (next seq); opened                  |
 * | O2  | menu.open             | another open                      | closed(replaced) the old one; opened the new   |
 * | C1  | menu.close(reason)    | open, no seq or the open one's    | open := none; closed(reason)                   |
 * | C2  | menu.close(reason)    | an earlier menu's seq             | nothing (a stale listener can't close another) |
 * | C3  | menu.close(reason)    | nothing open                      | nothing                                        |
 */
export function menus<P>(state: MenusState<P>, event: MenusEvent<P>): MenusTransition<P> {
  switch (event.type) {
    case "menu.open": {
      const seq = state.seq + 1;
      const opened = {
        kind: event.kind,
        seq,
        payload: event.payload,
        invoker: event.invoker,
        via: event.via,
        platform: event.platform,
      };
      const closed = state.open ? { ...state.open, reason: "replaced" as const } : null;
      return { state: { open: opened, seq }, closed, opened };
    }
    case "menu.close": {
      const open = state.open;
      if (!open || (event.seq !== undefined && event.seq !== open.seq)) return { state, closed: null, opened: null };
      return { state: { ...state, open: null }, closed: { ...open, reason: event.reason }, opened: null };
    }
  }
}

export function initialMenus<P>(): MenusState<P> {
  return { open: null, seq: 0 };
}

/** The camera's two kinds of menu (pane work waits while one is open); a dialog isn't one of them. */
export function cameraMenuKind(kind: SurfaceKind | undefined): "context" | "quickAdd" | null {
  if (kind === "context") return "context";
  if (kind === "quickAdd" || kind === "connected") return "quickAdd";
  return null;
}
