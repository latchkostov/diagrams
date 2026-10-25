import {
  initialReadout,
  readout,
  readoutTab,
  type ReadoutEvent,
  type ReadoutState,
  type ReadoutStop,
  type ReadoutTarget,
} from "./readout";
import type { FocusEvent, MenuCloseReason } from "./types";

/** What a readout layer asks of the canvas's controller: its focus policy, and whether a menu holds the canvas. */
export interface ReadoutHost {
  dispatch(event: FocusEvent): void;
  readonly menu: unknown;
}

/** Live's hover cards (createReadoutLayer). */
export interface ReadoutLayer {
  get(): ReadoutState["open"];
  subscribe(listener: () => void): () => void;
  point(target: ReadoutTarget | null): void;
  recordFocus(target: ReadoutTarget | null): void;
  pin(target: ReadoutTarget): void;
  visible(target: ReadoutTarget): boolean;
  readable(target: ReadoutTarget): boolean;
  reconcile(eligible: (target: ReadoutTarget) => boolean): void;
  close(reason: MenuCloseReason): void;
  dismiss(): void;
  enter(target: ReadoutTarget): boolean;
  retrace(target: ReadoutTarget): void;
  tab(el: Element | null, back: boolean, nav: ReadoutNav, pending?: ReadoutTarget): boolean | undefined;
}

/** Canvas navigation's view of its reading order, for Tab across a readout (useCanvasNavigation). */
export interface ReadoutNav {
  /** The item is this canvas's (not another canvas's, nor gone). */
  has(target: ReadoutTarget): boolean;
  /** Select and focus the item, as Tab between canvas items does. */
  go(target: ReadoutTarget): boolean;
  /** The node after the item in reading order (from a connection: after its source); null past the last. */
  after(target: ReadoutTarget): string | null;
}

/** A Live readout card: portalled to the page's body, outside canvas-wrap. */
const READOUT = "[data-live-readout]";
const TABBABLE = 'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';

/** Where `el` sits in a readout card's Tab stops (null: not in one). Tab's direction is decided in readout.ts. */
export function readoutStop(el: Element | null): ReadoutStop | null {
  const card = el?.closest<HTMLElement>(READOUT);
  const kind = card?.dataset.liveReadout;
  const id = card?.dataset.item;
  if (!el || !card || (kind !== "node" && kind !== "edge") || id === undefined) return null;
  const stops = [card, ...card.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (stop) =>
      stop.tabIndex >= 0 && !stop.hasAttribute("disabled") && !stop.closest("[hidden]") && stop.getClientRects().length,
  );
  return { target: { kind, id }, pinned: card.dataset.pinned === "true", card: el === card, last: stops.at(-1) === el };
}

/** Whether this item's card is shown (placed, so it can take focus; a card with no free slot is hidden). */
const shown = (target: ReadoutTarget) => {
  const el = document.querySelector<HTMLElement>(
    `${READOUT}[data-live-readout="${target.kind}"][data-item="${CSS.escape(target.id)}"]`,
  );
  return !!el && el.style.visibility !== "hidden";
};

/** Whether keyboard focus is inside this item's card (Tab reached it, or it was pinned and took focus). */
const holds = (target: ReadoutTarget) => {
  const card = document.activeElement?.closest<HTMLElement>(READOUT);
  return card?.dataset.liveReadout === target.kind && card.dataset.item === target.id;
};

/**
 * Live's hover cards, attached to the canvas's interaction controller while Live shows them (NodeBadges). The open
 * card is its own store (get / subscribe): hovering never re-renders what reads the canvas's snapshot. Every focus move
 * it causes is a focus-policy event (readout.closed, readout.entered, readout.left) the controller runs. It ships with
 * Live, not in the canvas's first view.
 */
export function createReadoutLayer(host: ReadoutHost, dom = { stop: readoutStop, shown, holds }): ReadoutLayer {
  let state: ReadoutState = initialReadout();
  let eligible = (_target: ReadoutTarget) => true;
  const listeners = new Set<() => void>();
  /** Applies a readout event; only a different open card notifies subscribers. */
  const read = (event: ReadoutEvent | null) => {
    const before = state.open;
    state = event ? readout(state, event) : initialReadout();
    if (state.open !== before) for (const l of listeners) l();
  };
  return {
    /** The open readout (useSyncExternalStore with subscribe). */
    get: () => state.open,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    /** The pointer or keyboard focus names an item (null: nothing) for an unpinned readout. */
    point(target: ReadoutTarget | null) {
      // Keyboard ownership lasts until focus leaves the card, independently of pinning.
      if (!host.menu && !(state.open && dom.holds(state.open)))
        read({ type: "point", target: target && eligible(target) ? target : null });
    },
    recordFocus: (target) => read({ type: "focus", target }),
    pin(target: ReadoutTarget) {
      if (!host.menu && eligible(target)) read({ type: "pin", target });
    },
    visible: (target) => eligible(target) && dom.shown(target),
    readable: (target) => eligible(target),
    reconcile(next) {
      eligible = next;
      if (state.open && !eligible(state.open)) this.close("remote");
    },
    /**
     * Esc dismisses it until something else is pointed at; anything else closes it outright. A card that held keyboard
     * focus (pinned, or an unpinned summary Tab reached) gives it back to its item on Esc: it is about to unmount. A card
     * only hovered leaves focus wherever it is.
     */
    close(reason: MenuCloseReason) {
      const target = state.open;
      const hadFocus = !!target && (!!state.focused || dom.holds(target));
      read(reason === "escape" ? { type: "close" } : null);
      if (target) host.dispatch({ type: "readout.closed", target, hadFocus, reason });
    },
    /** A menu or dialog opened over the canvas: the card goes, focus is the menu's. */
    dismiss: () => read({ type: "close" }),
    /** Tab from an item whose card is shown steps into the card before the next node. */
    enter(target: ReadoutTarget) {
      if (!dom.shown(target)) return false;
      host.dispatch({ type: "readout.entered", target, opening: false });
      return true;
    },
    /**
     * Shift+Tab to the previous node retraces Tab: its card opens (releasing a pinned one) and takes focus once drawn,
     * else focus stays on the node. Only while Live shows readouts (one is open).
     */
    retrace(target: ReadoutTarget) {
      if (!state.open || host.menu || !eligible(target)) return;
      read({ type: "release" });
      read({ type: "point", target });
      host.dispatch({ type: "readout.entered", target, opening: true });
    },
    /**
     * Tab or Shift+Tab from inside a card (readoutTab): back to its item, on past it, or the browser's Tab within it.
     * Undefined: focus isn't in a readout, so canvas navigation goes on as usual.
     */
    tab(el: Element | null, back: boolean, nav: ReadoutNav, pending?: ReadoutTarget): boolean | undefined {
      const at = pending
        ? { target: pending, pinned: !!state.open?.pinned, card: true, last: !state.open?.pinned }
        : dom.stop(el);
      if (!at) return undefined;
      const owner = at.target;
      if (!nav.has(owner)) return false;
      const way = readoutTab(at, back);
      if (way === "native") return false;
      if (way === "owner") return nav.go(owner);
      // Keyboard traversal moves on: a pinned card becomes a summary the next item's readout replaces.
      read({ type: "release" });
      const next = nav.after(owner);
      if (next) return nav.go({ kind: "node", id: next });
      // Past the last node, Tab leaves the canvas from the readout's item, as it does from the item itself.
      host.dispatch({ type: "readout.left", target: owner });
      return false;
    },
  };
}
