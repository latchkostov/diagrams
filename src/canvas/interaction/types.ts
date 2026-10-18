/**
 * The canvas's menus, keyboard focus and selection, as events with their cause (see index.ts).
 *
 * Elements (a menu's invoker, the Checks card's opener) travel as opaque handles: the pure policy never looks
 * inside one, and the controller's port checks one is still in the document before focus goes to it.
 */
export type ElementHandle = object;

/** The platform, given to the policy by the call site (macOS Control-click opens a menu): never inferred. */
export type Platform = "mac" | "other";

/**
 * What can be open over the canvas, one at a time: a context menu (a node, an edge, a boundary, a note, the
 * selection or the pane), quick-add (a double-click, a dropped connection), quick-add beside its outline (Alt+arrow,
 * the "+"), or a dialog the canvas opens (the keyboard shortcuts).
 */
export type SurfaceKind = "context" | "quickAdd" | "connected" | "dialog";

/**
 * Why a menu closed. `pick`: an item ran. `escape`: Esc in the menu or on the canvas. `outside`: a press outside it.
 * `scroll`: the wheel, or a pan by hand. `replaced`: another menu opened in its place. `blur`: the window lost
 * focus. `resize`: the window resized. `gesture`: a drag or a connection started. `command`: a canvas command that
 * acts without it (Alt+Shift+arrow). `unmount`: the canvas went away or stopped being editable.
 */
export type MenuCloseReason =
  "pick" | "escape" | "outside" | "scroll" | "replaced" | "blur" | "resize" | "gesture" | "command" | "unmount";

/** How a menu was asked for: a pointer (a right-click, macOS Control-click, a double-click) or a key. */
export type MenuVia = "pointer" | "keyboard";

export interface OpenSurface<P = unknown> {
  kind: SurfaceKind;
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
      kind: SurfaceKind;
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
  | { kind: "paletteSearch" };

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
  /** Only the canvas's Tab stop moves (to the target, once it resolves); focus stays where it is. */
  | { type: "roving"; target: FocusTarget; when: FocusWhen };

/** The Esc on the canvas, a menu closing, a selection with its cause, ...: everything the focus policy decides on. */
export type FocusEvent =
  | {
      type: "menu.closed";
      kind: SurfaceKind;
      reason: MenuCloseReason;
      invoker: ElementHandle | null;
      platform: Platform;
    }
  | { type: "menu.opened"; kind: SurfaceKind; via: MenuVia; platform: Platform }
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
  /** The Checks card closed (Esc, its close button): focus goes back to what opened it. */
  | { type: "dialog.closed"; dialog: "checks"; opener: ElementHandle | null }
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

/** What tests and the e2e journal see: nothing open or pending, a menu or dialog open, or focus waiting to move. */
export type InteractionPhase = "idle" | "menu-open" | "focus-pending";
