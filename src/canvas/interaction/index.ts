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
