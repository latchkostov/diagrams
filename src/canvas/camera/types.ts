import type { CameraOwner } from "../cameraOwnership";
import type { Viewport } from "../geometry/fit";
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

/**
 * Live's own work, which waits for the pane like pane work: its side panel or the trace card opened or closed, a
 * note's focus changed, it added a node, or slow motion started a take (or needs one for a new pane).
 */
export type LiveCause = "narration" | "live.panel" | "live.card" | "live.added" | "slowmo.take";
/** What a Live fit is for, in the journal: the pane changed, or one of Live's causes. */
export type LiveFitReason = "pane" | "panel" | "card" | "narration" | "added";

/**
 * Work held as data until the pane settles (and, for the canvas's pane work, until no menu is open). `panel`: a
 * node Live added is brought in clear of the open side panel.
 */
export type PaneWork =
  { cause: PaneCause } | { cause: Exclude<LiveCause, "live.added"> } | { cause: "live.added"; panel: boolean };

/** Live's room on the canvas: what covers the right of the pane, and the note that has the view's focus. */
export interface LiveRoom {
  /** The simulation or capacity panel is open (it covers the right 440 px). */
  panel: boolean;
  /** The trace card is open (top right). */
  card: boolean;
  /** The nodes the current note focuses on (none: no note, or a note without focus). */
  focus: readonly string[];
}

export interface PolicyState {
  owner: CameraOwner;
  mode: CameraMode;
  menu: MenuKind | null;
  /** Pane work waiting for the pane to settle (and for any menu to close). */
  pending: PaneWork | null;
  /** Zoom to selection owns the view until the next input: reveals queued before it give way. */
  zoomPriority: boolean;
  /** Live view's room (all clear outside it). */
  live: LiveRoom;
  /** Slow motion is recording or replaying a journey: it keeps its own camera. */
  slowmo: boolean;
  /** Who had the view when slow motion took it: it goes back when slow motion ends. */
  resume: CameraOwner;
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
  /** Live's note changed: its focus takes the view (narration), or, when a focused note ends, the fit is back. */
  | { type: "narration"; focus: readonly string[] }
  /** Live's simulation or capacity panel opened or closed (it covers the right of the pane). */
  | { type: "live.panel"; open: boolean }
  /** Live's trace card opened or closed. */
  | { type: "live.card"; open: boolean }
  /** Live added a node (a consumer, a dead-letter queue, an entry point): bring it into view once it's measured. */
  | { type: "live.added"; panel: boolean }
  /**
   * Slow motion started (recording ahead, then replaying) or ended. It takes the view (owner `slowmo`) and gives it
   * back to its owner from before; `restore`: the view to go back to.
   */
  | { type: "slowmo"; on: boolean; restore?: Viewport | null }
  /** A take starts, or its room changed (presenting, a panel, a recording): plan its camera once the pane settles. */
  | { type: "slowmo.take" }
  /** Following: a pan between hops, to keep the frontier in view (only while slow motion owns the view). */
  | { type: "slowmo.follow"; view: Viewport }
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
  | { type: "center" }
  /** Live's whole-diagram fit: clear of the live bar, the open side panel, or beside the trace card. */
  | { type: "liveFit"; reason: LiveFitReason; panel: boolean; card: boolean }
  /** The note's focus, clear of the open side panel or the trace card's column. */
  | { type: "noteFit"; reason: LiveFitReason; focus: readonly string[]; panel: boolean; card: boolean }
  /** Slow motion plans its camera for the take (a fit of the path, or following from its first node). */
  | { type: "slowmoPlan" }
  /** The pane changed under slow motion: it holds a paused replay's view, or replans a playing, fitted one. */
  | { type: "slowmoPane"; following: boolean }
  | { type: "follow"; view: Viewport }
  /** Back to the view from before slow motion. */
  | { type: "restore"; view: Viewport };

export interface Decision {
  state: PolicyState;
  commands: CameraCommand[];
}

/** What tests and the e2e journal see: idle, work waiting for the pane (or a menu), or a move running. */
export type CameraPhase = "idle" | "pending" | "deferred" | "animating";
