// The canvas's menus, keyboard focus and selection causes: what opens over the canvas, where focus goes, and why.
//
// How it fits together (it reads like src/canvas/camera)
// - types.ts: the events (each with its cause), the commands, the policy state.
// - menus.ts: menus(state, event) -> { state, closed, opened }. Pure: one surface open at a time (a context menu,
//   quick-add, quick-add beside its outline, the shortcuts dialog), opened with what had focus, closed with a reason
//   (pick, escape, outside, scroll, replaced, blur, resize, gesture, command, unmount).
// - focusPolicy.ts: focusPolicy(state, event) -> { state, command }. Pure: where focus goes, as a table, with exactly
//   one command per event (keep, a focus move, or a move of the canvas's Tab stop).
// - controller.ts: the single writer. It runs the menus machine (and tells the camera menu.opened / menu.closed), feeds
//   the focus policy and runs its moves through its port (the DOM), at the time each names: now, after the commit, on
//   a frame, or once the target is mounted and measured. The pending move is data: a newer one replaces it, it never
//   lands on an element that has left the document, and it waits on commits and rendered frames, never on a timer. A
//   selection change is one selection.changed event with the cause its source declared, heard by the focus policy and
//   the camera. It publishes data-interaction-state (idle | menu-open | focus-pending) on canvas-wrap and, in e2e
//   builds, the journal (journal.ts, window.__interactionJournal).
// - liveKeys.ts: liveKeys(context) -> level. Pure: which level takes Space, Enter or Esc in live view (Esc backs out
//   one level: its owners first, then the selection, the message trace, the highlighted path, live view itself).
//   Live's keyboard (src/live/session/useLiveKeyboard.ts) asks the controller (liveKey), which journals it.
// - domPort.ts: the DOM behind the port; useInteraction.ts: the hooks CanvasView and the Inspector call.
//
// Adding menu, focus or selection behaviour
// 1. Add an event to FocusEvent (types.ts) with its cause, or a cause to an existing event.
// 2. Add a row to the table in focusPolicy.ts and its case, plus a row in focusPolicy.test.ts. The invariant
//    cross-product and the event-sequence tests there, and the interleavings in controller.test.ts, must still pass.
// 3. If it needs a new kind of target or timing, add it to FocusTarget / FocusWhen and resolve it in domPort.ts.
// 4. Dispatch the event from the call site that knows the cause.
// Never call .focus(), open or close a menu with a state setter, or wait a frame "for focus to settle" in
// src/canvas or src/live: ESLint (eslint.config.js) rejects .focus() and menu setters outside this directory, apart
// from a short, justified allowlist of focus that stays inside one component.
export type {
  ElementHandle,
  FocusCommand,
  FocusDecision,
  FocusEvent,
  FocusMove,
  FocusOrigin,
  FocusState,
  FocusTarget,
  FocusWhen,
  InteractionPhase,
  LiveKey,
  LiveKeyAction,
  LiveKeyContext,
  MenuCloseReason,
  MenuVia,
  MenusEvent,
  MenusState,
  MenusTransition,
  OpenSurface,
  Platform,
  SelectionCause,
  SurfaceKind,
} from "./types";
export {
  createInteractionController,
  type InteractionCamera,
  type InteractionController,
  type InteractionEntry,
  type InteractionPort,
  type InteractionScheduler,
  type Resolution,
} from "./controller";
export { focusPolicy, initialFocus } from "./focusPolicy";
export { liveKeys } from "./liveKeys";
export { domActive, PANEL_OPENER_ATTR } from "./domPort";
export { cameraMenuKind, initialMenus, menus } from "./menus";
export {
  InteractionContext,
  useInteraction,
  useInteractionCamera,
  useInteractionCore,
  useInteractionOrLocal,
  useSelectionEvents,
} from "./useInteraction";

/** What the canvas's hooks use to move focus: events in, the pending move and the Tab stop out. */
export type FocusApi = Pick<
  import("./controller").InteractionController,
  "dispatch" | "focusing" | "pendingTarget" | "rendered" | "state"
>;
/** Where placements declare themselves: the next selection (and pane change) comes from placing a new item. */
export type Placing = Pick<import("./controller").InteractionController, "placing">;
