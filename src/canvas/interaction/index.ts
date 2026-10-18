// The canvas's menus, keyboard focus and selection causes: what opens over the canvas, where focus goes, and why.
//
// How it fits together (it reads like src/canvas/camera)
// - types.ts: the events (each with its cause), the commands, the policy state.
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
  type InteractionPort,
} from "./controller";
export { cameraMenuKind, initialMenus, menus } from "./menus";
export { InteractionContext, useInteraction, useInteractionCore, useInteractionOrLocal } from "./useInteraction";
/** What the canvas's hooks use to move focus: events in, the pending move and the Tab stop out. */
export type FocusApi = Pick<
  import("./controller").InteractionController,
  "dispatch" | "focusing" | "pendingTarget" | "rendered" | "state"
>;
/** Where placements declare themselves: the next selection (and pane change) comes from placing a new item. */
export type Placing = Pick<import("./controller").InteractionController, "placing">;
