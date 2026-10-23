/**
 * The canvas's menus, keyboard focus and selection, as events with their cause (see index.ts).
 *
 * Elements (a menu's invoker, the Checks card's opener) travel as opaque handles: the pure policy never looks
 * inside one, and the controller's port checks one is still in the document before focus goes to it.
 */
export type ElementHandle = object;

/** The platform, given to the policy by the call site (macOS Control-click opens a menu): never inferred. */
export type Platform = "mac" | "other";

/** The exclusive canvas surfaces: opening one replaces the previous one and holds interaction readiness. */
export type CanvasSurfaceKind = "context" | "quickAdd" | "connected" | "dialog";

/**
 * Focus notifications also cover independent popovers on Live's bar (its more menu and expectations list).
 * They never enter the exclusive menus machine, replace a canvas surface or hold interaction readiness.
 */
export type MenuFocusKind = CanvasSurfaceKind | "live";

/**
 * Why a menu closed. `pick`: an item ran. `escape`: Esc in the menu or on the canvas. `outside`: a press outside it.
 * `scroll`: the wheel, or a pan by hand. `replaced`: another menu opened in its place. `blur`: the window lost
 * focus. `resize`: the window resized. `gesture`: a drag or a connection started. `command`: a canvas command that
 * acts without it (Alt+Shift+arrow). `toggle`: the control that opened it, pressed again (Live's bar). `unmount`:
 * the canvas went away or stopped being editable (or Live's bar went away). `remote`: a peer in a room deleted what
 * it was for (a context menu on a node or a connection that has gone).
 */
export type MenuCloseReason =
  | "pick"
  | "escape"
  | "outside"
  | "scroll"
  | "replaced"
  | "blur"
  | "resize"
  | "gesture"
  | "command"
  | "toggle"
  | "unmount"
  | "remote";

/** How a menu was asked for: a pointer (a right-click, macOS Control-click, a double-click) or a key. */
export type MenuVia = "pointer" | "keyboard";

export interface OpenSurface<P = unknown> {
  kind: CanvasSurfaceKind;
  /** Counts opens: a close from an earlier menu's listeners never closes a later one. */
  seq: number;
  payload: P;
  /** What had focus as it opened: Esc gives focus back to it. */
  invoker: ElementHandle | null;
  via: MenuVia;
  platform: Platform;
}

export interface MenusState<P = unknown> {
  open: OpenSurface<P> | null;
  seq: number;
}

export type MenusEvent<P = unknown> =
  | {
      type: "menu.open";
      kind: CanvasSurfaceKind;
      payload: P;
      invoker: ElementHandle | null;
      via: MenuVia;
      platform: Platform;
    }
  /** `seq`: close only that menu (its own listeners); absent: whatever is open. */
  | { type: "menu.close"; reason: MenuCloseReason; seq?: number };

export interface MenusTransition<P = unknown> {
  state: MenusState<P>;
  /** The menu that closed, and why (a replaced menu closes with `replaced` before the new one opens). */
  closed: (OpenSurface<P> & { reason: MenuCloseReason }) | null;
  opened: OpenSurface<P> | null;
}

/**
 * Why the selection changed. `click`: a click or a right-click on the canvas. `box`: the selection box. `keyboard`:
 * Tab, Shift+Tab, Ctrl+Alt+arrows, Ctrl+Alt+] / [. `undo` / `redo`: a history step chose it. `placement`: a new
 * item was placed (quick-add, T, a drop, the stencil rail). `palette`: the command palette went to a node or added
 * one. `programmatic`: anything else (a menu's command, a check's reveal, a rename).
 */
export type SelectionCause = "click" | "box" | "keyboard" | "undo" | "redo" | "placement" | "palette" | "programmatic";

/** Where focus was when a history step ran: on the canvas (a node, an edge, the canvas) or elsewhere (the toolbar). */
export type FocusOrigin = "canvas" | "elsewhere";

/** Somewhere keyboard focus can go. */
export type FocusTarget =
  | { kind: "node"; id: string }
  | { kind: "edge"; id: string }
  /** A node or a connection with this flow id: what a name field names. */
  | { kind: "item"; id: string }
  /** The canvas itself (canvas-wrap), the page's keyboard home while the canvas is shown. */
  | { kind: "canvas" }
  /** The first of these nodes in Tab's order, else the first of these connections. */
  | { kind: "selection"; nodes: readonly string[]; edges: readonly string[] }
  /** An element captured earlier: a menu's invoker, the Checks card's opener, the node Esc was pressed on. */
  | { kind: "element"; handle: ElementHandle }
  /** An Inspector field (`owner`: the flow id its name field names, when it must be that item's). */
  | { kind: "field"; name: string; owner?: string }
  /** The stencil rail's search. */
  | { kind: "paletteSearch" }
  /** The Live bar's control that opens its side panels ("⋯", data-live-panel-opener). */
  | { kind: "panelOpener" }
  /** A field (by test id) in one of Live's side panels: waits while the panel is open and the field isn't yet. */
  | { kind: "panelField"; panel: string; field: string }
  /** A node's or a connection's Live readout card (portalled outside canvas-wrap), while it is shown. */
  | { kind: "readout"; item: "node" | "edge"; id: string };

/**
 * When a focus command runs. `now`: at once. `commit`: once React has committed the change that caused it, after
 * that commit's own focus moves (a menu that closed, an action that ran). `frame`: on the next frame. `frames2`:
 * two frames later (React Flow blurs a node it unselects a frame late). `ready`: as soon as the target is mounted,
 * measured and visible (a field whose panel hasn't opened), now or on a later commit or frame. `measured`: the same,
 * from the next frame on (after React has drawn the change that caused it: Undo's restored canvas, a new node).
 */
export type FocusWhen = "now" | "commit" | "frame" | "frames2" | "ready" | "measured";

export interface FocusMove {
  type: "focus";
  target: FocusTarget;
  when: FocusWhen;
  /** Where focus goes when the target has gone or won't take focus (absent: focus stays where it is). */
  fallback?: FocusTarget;
  /** Only when focus has been lost to the page (nothing, or the body): a move someone else made wins. */
  onlyIfLost?: boolean;
  /** Only when this element (what had focus) has left the document. */
  ifGone?: ElementHandle;
  /** A text field: select all of it, or put the caret at its end. */
  select?: "all" | "end";
  /** Again a frame later, unless input came first or focus is already there (a closing menu took it back). */
  again?: boolean;
  /** This is that second attempt: it doesn't count as pending, and input stands it down. */
  retry?: boolean;
  /**
   * The target is new: it isn't in the diagram yet, and arrives with a later commit (the palette's add may commit
   * after the next frame). Missing, it waits until the diagram has changed without it, rather than counting as gone.
   */
  fresh?: boolean;
  /**
   * The caller brings the target into view itself (keyboard navigation, Undo): the focus doesn't also ask the
   * camera for a focus reveal.
   */
  revealed?: boolean;
  /** Runs when the target is found and about to take focus; false drops the move (another reader consumed it). */
  claim?: () => boolean;
}

export type FocusCommand =
  /** Focus stays where it is. */
  | { type: "keep" }
  | FocusMove
  /** Conditional peer recovery beside a user move; it never consumes that move. */
  | { type: "recover"; target: FocusTarget; when: "frame"; onlyIfLost: true; ifGone: ElementHandle }
  /** Only the canvas's Tab stop moves (to the target, once it resolves); focus stays where it is. */
  | { type: "roving"; target: FocusTarget; when: FocusWhen };

/** The Esc on the canvas, a menu closing, a selection with its cause, ...: everything the focus policy decides on. */
export type FocusEvent =
  /**
   * A Live readout closed. `pinned` records pin state; `hadFocus` records keyboard focus inside the closing card. Esc gives focus back to
   * its item; a card only hovered leaves focus alone (readoutLayer.ts decides).
   */
  | {
      type: "readout.closed";
      target: { kind: "node" | "edge"; id: string; pinned: boolean };
      hadFocus?: boolean;
      reason: MenuCloseReason;
    }
  /**
   * Tab or Shift+Tab steps into an item's readout card (readout.ts, readoutTab). `opening`: Shift+Tab from the next
   * node opens it with this step, so it is drawn by the commit that follows; else it is already shown.
   */
  | { type: "readout.entered"; target: { kind: "node" | "edge"; id: string }; opening: boolean }
  /** Tab leaves a readout past the canvas's last node: focus goes to its item now, and the browser's Tab goes on. */
  | { type: "readout.left"; target: { kind: "node" | "edge"; id: string } }
  | {
      type: "menu.closed";
      kind: MenuFocusKind;
      reason: MenuCloseReason;
      invoker: ElementHandle | null;
      platform: Platform;
    }
  | { type: "menu.opened"; kind: MenuFocusKind; via: MenuVia; platform: Platform }
  | {
      type: "selection.changed";
      cause: SelectionCause;
      /** Keyboard navigation's destination, the palette's node. */
      target?: { kind: "node" | "edge"; id: string };
      /** A history step's selection. */
      selection?: { nodes: readonly string[]; edges: readonly string[] };
      /** Where focus was (history steps). */
      origin?: FocusOrigin;
      /** The palette added the node (it focuses once drawn) rather than went to it. */
      placed?: boolean;
    }
  /** Enter or Esc in a name field: naming is done. */
  | { type: "naming.done"; flowId: string }
  /** The Inspector was asked to focus one of its fields (F2, Enter, a double-click, Rename, a new node's name). */
  | {
      type: "inspector.field";
      seq: number;
      name: string;
      owner?: string;
      caret?: "end";
      claim?: () => boolean;
    }
  /** The Inspector opened or folded, by its own control (`panel`) or with the selection. */
  | { type: "inspector.toggled"; cause: "panel" | "selection" }
  /** A modal takes its first field, or wraps Tab within its own controls. */
  | { type: "dialog.opened"; first: ElementHandle }
  | { type: "dialog.tab"; target: ElementHandle }
  /** Tab from a node enters its scrollable live details. */
  | { type: "node.details"; target: ElementHandle; source?: "timeline" }
  /**
   * A dialog or panel closed, and focus goes back to what opened it. `checks`: the Checks card (Esc, its close
   * button). `livePanel`: one of Live's side panels (Esc), back to its opener, else the Live bar's panel opener.
   * `inject`: Live's inject dialog (any way it closed), back to its opener, else the node it injects at (`node`).
   * `room`: a room's dialog (start, join, a link that can't be opened, the copy that couldn't be saved).
   */
  | {
      type: "dialog.closed";
      dialog: "checks" | "livePanel" | "inject" | "room";
      opener: ElementHandle | null;
      /** inject: the node it was opened on. */
      node?: string;
      reason?: MenuCloseReason;
    }
  /** Space, Enter or Esc in live view, and the level that took it (liveKeys.ts). */
  | { type: "live.key"; key: LiveKey; action: LiveKeyAction }
  /** A pausing note while presenting: its Continue button takes the keyboard. */
  | { type: "narration.waiting"; resume: ElementHandle }
  /** A Live callout went away; its Undo toast gives focus back after the history commit. */
  | { type: "callout.closed"; hadFocus: boolean; undo?: true }
  /** A notice containing keyboard focus is about to disappear; hand it to the surviving status. */
  | { type: "notice.closed"; status: ElementHandle }
  /** A Live panel's field should take the cursor once the panel lists it (a new entry point's rate). */
  | { type: "panel.field"; panel: string; field: string }
  /** Esc on the canvas, from `from` (a node or an edge), clearing the selection. */
  | { type: "escape"; from: ElementHandle | null }
  /** The gallery handed the keyboard to this canvas (after its dialog's teardown restored the opener). */
  | { type: "canvas.requested" }
  /** Presenting started (the button that started it is hidden). */
  | { type: "presenting" }
  /** The start card's "Start blank": the stencil rail opens with the cursor in its search. */
  | { type: "start.blank" }
  /** Hidden dependencies: a focused dependency edge has gone. */
  | { type: "dependencies.hidden"; focusOnDependency: boolean }
  /** A joiner's wait for the room's diagram took the canvas's place: it takes focus that was lost with the canvas. */
  | { type: "room.waiting"; region: ElementHandle }
  /** The room's diagram arrived and its canvas replaced the wait. */
  | { type: "room.ready" }
  /** A room's connection state changed; `retry`: the person pressed Retry (the control goes, its status stays). */
  | { type: "room.status"; state: string; retry: boolean; status: ElementHandle }
  /** A peer's change replaced the document while `active` (in this canvas) had focus. */
  | { type: "document.replaced"; active: ElementHandle | null }
  /** Focus arrived on a canvas node (a click, Tab into the canvas, a screen reader): it is the Tab stop now. */
  | { type: "focus.entered"; id: string }
  /** A selection target resolved to this node (Undo's first selected node in Tab's order). */
  | { type: "focus.resolved"; id: string }
  /** The pending move ran: it goes again a frame later if it asked to (`again`), else nothing is pending. */
  | { type: "focus.ran" }
  /** The pending move gave up (its target has gone, it was claimed elsewhere): nothing is pending. */
  | { type: "focus.done" }
  /** A press or a key anywhere: a move's second attempt stands down. */
  | { type: "input" };

export interface FocusState {
  /** Surfaces currently owning focus, including independent Live popovers. */
  openMenus?: readonly MenuFocusKind[];
  /** The canvas's one Tab stop (a node's flow id), when one has been chosen. */
  roving?: string;
  /** The move waiting to run, as data (at most one: a newer move replaces it). */
  pending: FocusMove | null;
  /** The latest Inspector field request taken: each runs once. */
  fieldSeq: number;
}

export interface FocusDecision {
  state: FocusState;
  /** Exactly one per event. */
  command: FocusCommand;
}

/** The keys live view handles itself (liveKeys.ts). */
export type LiveKey = "space" | "enter" | "escape";

/**
 * Which level took Space, Enter or Esc in live view (liveKeys.ts). Someone else's: `slowmo` (slow motion's own
 * keys), `recording` (the recorder's Esc), `editor` (a text field or an inline editor), `owner` (an open menu,
 * dialog or Live panel), `canvas` (the canvas clears the selection itself), `presentation` (presenting leaves on
 * Esc), `none` (nothing in live view: a control's own key, Enter with no note waiting, Esc in an always-on view).
 * Live's own: `selection` (clear it), `trace` (end the message trace), `path` (clear the highlighted path), `exit`
 * (leave live view), `toggle` (play or pause), `resume` (continue a waiting note), `repeat` (a held Space: swallowed).
 */
export type LiveKeyAction =
  | "slowmo"
  | "recording"
  | "editor"
  | "owner"
  | "canvas"
  | "selection"
  | "trace"
  | "presentation"
  | "path"
  | "exit"
  | "toggle"
  | "resume"
  | "repeat"
  | "close-readout"
  | "pin-readout"
  | "none";

/** What the call site knows as Space, Enter or Esc arrives (liveKeys.ts decides from it alone). */
export interface LiveKeyContext {
  key: LiveKey;
  /** Any open Live readout yields to recording, editors and panels before taking Esc. */
  readout?: boolean;
  /** The focused wrapper can pin its readout when naming does not own Enter. */
  readoutTarget?: boolean;
  /** A held key's repeats. */
  repeat: boolean;
  /** Slow motion is on, and this is a key it handles (Space as " ", Esc). */
  slowMotion: boolean;
  /** A recording is running (its indicator owns Esc). */
  recording: boolean;
  /** The key went to a text field or an inline editor. */
  editable: boolean;
  /** The key went to a control with its own Space and Enter (a button, a select, a link, an overlay, a splitter). */
  control: boolean;
  /** A menu, a dialog or one of Live's side panels is open (it takes Esc first). */
  owner: boolean;
  /** Something on the canvas is selected. */
  selection: boolean;
  /** Focus is on the canvas, outside the trace card: the canvas's own Esc clears the selection. */
  canvasFocus: boolean;
  /** A message trace is on. */
  trace: boolean;
  presenting: boolean;
  /** A highlighted path (everything downstream of an edge). */
  path: boolean;
  /** Live view can't be left (an always-on embed). */
  alwaysOn: boolean;
  /** A note waits for Continue. */
  waiting: boolean;
}

/** What tests and the e2e journal see: nothing open or pending, a menu or dialog open, or focus waiting to move. */
export type InteractionPhase = "idle" | "menu-open" | "focus-pending";
