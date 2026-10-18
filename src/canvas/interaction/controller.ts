import type { CameraEvent } from "../camera";
import { cameraMenuKind, initialMenus, menus } from "./menus";
import type { ElementHandle, MenuCloseReason, MenuVia, MenusState, OpenSurface, Platform, SurfaceKind } from "./types";

/** The camera, as the interaction controller feeds it (menu.opened / menu.closed). */
export interface InteractionCamera {
  dispatch(event: CameraEvent): void;
}

/** The DOM, as the controller sees it. */
export interface InteractionPort {
  /** What has focus now (null: nothing, or the page's body). */
  active(): ElementHandle | null;
}

export interface InteractionOptions {
  camera?: InteractionCamera;
}

export type InteractionController<P = unknown> = ReturnType<typeof createInteractionController<P>>;

/**
 * The single writer of what's open over the canvas. Menus open and close through it with a reason (menus.ts
 * decides); it tells the camera when a menu opens or closes.
 */
export function createInteractionController<P = unknown>(port: InteractionPort, options: InteractionOptions = {}) {
  let menuState: MenusState<P> = initialMenus<P>();
  /** The camera's view of the open menu (it hears of a change of kind only, as before). */
  let cameraMenu: "context" | "quickAdd" | null = null;
  const listeners = new Set<() => void>();
  let snapshot = { menu: null as OpenSurface<P> | null };

  function changed() {
    snapshot = { menu: menuState.open };
    for (const l of listeners) l();
  }

  function feedCamera() {
    const next = cameraMenuKind(menuState.open?.kind);
    if (next === cameraMenu) return;
    if (cameraMenu) options.camera?.dispatch({ type: "menu.closed" });
    if (next) options.camera?.dispatch({ type: "menu.opened", kind: next });
    cameraMenu = next;
  }

  return {
    /** The open menu or dialog, if any. */
    get menu(): OpenSurface<P> | null {
      return menuState.open;
    },
    /** For useSyncExternalStore: a new object whenever something it holds changes. */
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    /** Opens a menu (or a dialog) over the canvas, replacing any that's open; returns its seq. */
    openMenu(
      kind: SurfaceKind,
      payload: P,
      how: { via?: MenuVia; platform?: Platform; invoker?: ElementHandle | null } = {},
    ) {
      const t = menus(menuState, {
        type: "menu.open",
        kind,
        payload,
        invoker: how.invoker === undefined ? port.active() : how.invoker,
        via: how.via ?? "pointer",
        platform: how.platform ?? "other",
      });
      menuState = t.state;
      feedCamera();
      changed();
      return menuState.seq;
    },
    /** Closes the open menu (`seq`: only if it's still that one) with its reason. */
    closeMenu(reason: MenuCloseReason, seq?: number) {
      const t = menus(menuState, { type: "menu.close", reason, seq });
      if (!t.closed) return;
      menuState = t.state;
      feedCamera();
      changed();
    },
  };
}
