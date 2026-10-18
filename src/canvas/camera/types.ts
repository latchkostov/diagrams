import type { CameraOwner } from "../cameraOwnership";
import type { RevealScope } from "./controller";

export type { CameraOwner };

/**
 * Why the pane or the selection changed. `panel`: a side panel opened, closed or was resized by its own control,
 * shortcut, menu item or the command palette. `selection`: something was selected, by a click, a right-click, the
 * keyboard, Properties, Enter or a double-click. `placement`: a new item was placed (quick-add, T, a drop, a stencil).
 */
export type PaneCause = "panel" | "selection" | "placement";
/** What a reveal brings into view for: a pane change's cause, or a command that moves to something. */
export type RevealCause = PaneCause | "navigation" | "checks" | "focus" | "palette";
export type CameraMode = "edit" | "live" | "present";
export type MenuKind = "context" | "quickAdd";
/** The whole-diagram fits: Shift+1 and Fit view, a mode change, full screen, Reset, the Checks card, a pane change. */
export type FitReason = "command" | "mode" | "fullscreen" | "reset" | "checks" | "pane";

/** Pane work held as data until the pane settles and no menu is open. */
export interface PaneWork {
  cause: PaneCause;
}

export interface PolicyState {
  owner: CameraOwner;
  mode: CameraMode;
  menu: MenuKind | null;
  /** Pane work waiting for the pane to settle (and for any menu to close). */
  pending: PaneWork | null;
  /** Zoom to selection owns the view until the next input: reveals queued before it give way. */
  zoomPriority: boolean;
  /** The cause of the latest pane change (Live reads it for its own panel refits). */
  lastCause: PaneCause;
}

/** What the controller measured once the pane settled, for the pending work's decision. */
export interface SettledFacts {
  /** Something is selected. */
  selection: boolean;
  /** The selection is outside the pane or under floating chrome (the overlay-aware reveal would pan). */
  covered: boolean;
  /** The same for the selection with its connections. */
  coveredWithEdges: boolean;
  /** The diagram's centre is near or past the pane's edge. */
  centreOff: boolean;
}

export type CameraEvent =
  /** The pane's size changed: the Inspector, the stencils, the AI panel, a sheet resize, Live's panel. */
  | { type: "pane.changed"; cause: PaneCause }
  /** A new, non-empty selection (it replaces pending panel work, rule b). */
  | { type: "selection.changed"; cause: "selection" | "placement" }
  | { type: "menu.opened"; kind: MenuKind }
  /** A menu closed, by a pick or a dismissal (quick-add's pick is a placement, which replaces pending work). */
  | { type: "menu.closed" }
  /** A press, wheel, key or context menu anywhere: Zoom to selection's priority ends. */
  | { type: "input" }
  /** A pan or zoom by hand, a node drag, the zoom buttons. */
  | { type: "user.moved" }
  | { type: "fit"; reason: Exclude<FitReason, "mode" | "fullscreen" | "checks" | "pane"> }
  /** Shift+0 (keyboard only). */
  | { type: "zoom100" }
  /** Shift+2: the selection (or the hovered node) and its connections. */
  | { type: "zoomToSelection"; nodes?: ReadonlySet<string>; edges?: ReadonlySet<string> }
  | { type: "mode.changed"; mode: CameraMode }
  | { type: "fullscreen.changed" }
  /** The Checks card opened over the diagram (floating chrome). */
  | { type: "overlay.opened" }
  /** Live's narration took the view (a note's focus) or gave it back. */
  | { type: "narration"; focus: boolean }
  /** Something was selected or placed and measured: bring it into view (a pan, never a zoom). */
  | { type: "reveal.requested"; cause: RevealCause; scope?: RevealScope }
  /** The pane has its new size and the selection is measured: pending work may run. */
  | ({ type: "pane.settled" } & SettledFacts);

export type CameraCommand =
  | { type: "fit"; reason: FitReason }
  | { type: "zoomToSelection" }
  | { type: "zoom100" }
  /** The smallest overlay-aware pan that shows the selection (`withEdges`: and its connections). */
  | { type: "reveal"; cause: RevealCause; withEdges: boolean }
  /** Keep the diagram's centre in the pane (a manual view whose pane changed, nothing selected). */
  | { type: "center" };

export interface Decision {
  state: PolicyState;
  commands: CameraCommand[];
}

/** What tests and the e2e journal see: idle, work waiting for the pane (or a menu), or a move running. */
export type CameraPhase = "idle" | "pending" | "deferred" | "animating";
