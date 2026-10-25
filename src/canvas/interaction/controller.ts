import type { CameraEvent } from "../camera";
import type { TypeAhead } from "../typeAhead";
import { describe, focusPolicy, initialFocus, pendingMove } from "./focusPolicy";
import { liveKeys } from "./liveKeys";
import { gestures, initialGestures } from "./gestures";
import type { Gesture, GestureKind, GesturePreview, GestureEndReason } from "./types";
import type { ReadoutLayer } from "./readoutLayer";
import { cameraMenuKind, initialMenus, menus } from "./menus";
import { editorModeStep, initialEditorMode, type EditorModeEvent, type EditorModeState } from "./mode";
import type {
  ElementHandle,
  FocusCommand,
  SelectionCause,
  FocusEvent,
  FocusMove,
  FocusState,
  FocusTarget,
  InteractionPhase,
  LiveKeyAction,
  LiveKeyContext,
  MenuCloseReason,
  MenuVia,
  MenusState,
  OpenSurface,
  Platform,
  CanvasSurfaceKind,
} from "./types";

/** The camera, as the interaction controller feeds it (menu.opened / menu.closed, selection.changed). */
export interface InteractionCamera {
  dispatch(event: CameraEvent): void;
  /** The next pane change comes from placing a new item (the camera's own pane causes, usePaneCamera). */
  placing(): void;
}

/**
 * Where a target is now. `ready`: mounted, measured and visible. `waiting`: not yet, but it will be on a coming
 * frame (React Flow measuring a node). `parked`: it waits for something the person does or a commit brings (the
 * Inspector folded, its panel still showing the previous item). `gone`: removed or deliberately hidden.
 */
export type Resolution =
  | { state: "ready"; el: ElementHandle; node?: string }
  | { state: "waiting" | "parked"; node?: string }
  | { state: "gone" };

/** The DOM, as the controller sees it. Only the port calls focus(). */
export interface InteractionPort {
  /** What has focus now (null: nothing, or the page's body). */
  active(): ElementHandle | null;
  resolve(target: FocusTarget): Resolution;
  /** Moves focus to `el` (selecting a text field's text, or its end); true if focus is there now. */
  focus(el: ElementHandle, select?: "all" | "end"): boolean;
  /** Whether an element is still in the document. */
  connected(el: ElementHandle): boolean;
  /** Counts changes of the diagram as committed (a fresh target is gone only once the diagram changed without it). */
  version?(): number;
  /** Readiness: `data-interaction-state` (and the journal, in e2e builds). */
  publish(phase: InteractionPhase): void;
  /**
   * Holds keys typed anywhere, before the canvas's shortcuts see them (typeAhead.ts), for a name field that can't
   * take them yet; `done` hears the Enter or Esc that ended the typing. Absent: nothing is held.
   */
  holdKeys?(done: (typed: TypeAhead) => void): { stop(): TypeAhead };
  /** Dismiss the newest pending modal input owner before its dialog has mounted. */
  dismissPendingModal?(): boolean;
  /** Writes text typed ahead into the text field that has just taken focus, as typing there would; caret after it. */
  type?(el: ElementHandle, text: string): void;
  /** Focus on `el` has left the canvas's keyboard: it's outside the canvas, or a text field. */
  elsewhere?(el: ElementHandle): boolean;
  /** The text field `el` is, for the editor's mode: a name field (`target`: whose) or another field. Else null. */
  field?(el: ElementHandle): { target?: string; field?: string } | null;
}

/**
 * The frame clock. Injected so unit tests drive frames by hand and a slow machine is only an interleaving:
 * nothing here waits on wall-clock time.
 */
export interface InteractionScheduler {
  frame(run: () => void): () => void;
  microtask(run: () => void): void;
}

/** One decision or one executed move, for the e2e journal and the unit tests. */
export interface InteractionEntry {
  seq: number;
  /** What happened: an event decided ("menu.closed:escape"), or a move's outcome. */
  event: string;
  /** The command decided ("focus:node:a@frame", "keep"), or the move that ran. */
  command: string;
  /** For a move that ran: where focus went. */
  result?: "focused" | "fallback" | "kept" | "gone" | "superseded";
}

export interface InteractionOptions {
  camera?: InteractionCamera;
  journal?: (entry: InteractionEntry) => void;
}

export type InteractionController<P = unknown> = ReturnType<typeof createInteractionController<P>>;

/** Said once a move has finished: whether focus went where it was asked to go (or to its fallback). */
type Done = (focused: boolean) => void;

interface GestureHandlers {
  commit(p: GesturePreview): void;
  cancel?(): void;
  /** Current external capture identity. Cancellation belongs only to the token read at gesture start. */
  capture?(): unknown;
}

/**
 * The single writer of what's open over the canvas and of keyboard focus in it. Menus open and close through it
 * with a reason (menus.ts); every focus move is a command from the pure policy (focusPolicy.ts), run here
 * through the port, at the time it names: now, after the commit, on a frame, or once its target is ready. The
 * pending move is data (the policy's `pending`): a newer one replaces it, it never lands on an element that has
 * left the document, and it waits for its target on commits and rendered frames, never on a timer.
 */
export function createInteractionController<P = unknown>(
  port: InteractionPort,
  scheduler: InteractionScheduler,
  options: InteractionOptions = {},
) {
  let menuState: MenusState<P> = initialMenus<P>();
  let gestureState = initialGestures();
  let segmentRoute: { edge: string; signature: string; expected?: string } | null = null;
  let panHeld = false;
  let gestureHow: (GestureHandlers & { owner: unknown }) | null = null;
  /** Live's hover cards, while Live attaches them (readoutLayer.ts): their own store, apart from the snapshot. */
  let readouts: ReadoutLayer | null = null;
  const escapes: (() => boolean)[] = [];
  let camera = options.camera;
  let focus: FocusState = initialFocus();
  /** The camera's view of the open menu (it hears of a change of kind only, as before). */
  let cameraMenu: "context" | "quickAdd" | null = null;
  const listeners = new Set<() => void>();
  let snapshot = {
    menu: null as OpenSurface<P> | null,
    roving: undefined as string | undefined,
    keyboardSegment: gestureState.keyboardSegment,
  };
  let seq = 0;
  /** The pending move's last resolution was `parked`: it waits on commits, and readiness doesn't count it. */
  let parked = false;
  /** Cancels the frame the pending move waits on. */
  let cancelFrame: (() => void) | null = null;
  /** Cancels the frame a Tab-stop move waits on (a newer one replaces it). */
  let cancelRoving: (() => void) | null = null;
  /** Conditional recovery may wait beside a user move, without replacing its destination or callback. */
  let recovery: {
    command: Extract<FocusCommand, { type: "recover" }>;
    cancel: () => void;
    then?: Done;
  } | null = null;
  /** The move whose outcome is still to be told (to the journal and its caller). */
  let current: { move: FocusMove; then?: Done } | null = null;
  /** The pending move has been tried at least once (a `measured` move waits for its first frame). */
  let begun = false;
  /** The diagram's version when the pending move was decided. */
  let issuedAt = 0;
  /** A move running inside port.focus (the focusin it causes reads it). */
  let running: FocusMove | null = null;
  let disposed = false;
  let lastPhase: InteractionPhase | null = null;
  /** The cause declared for the selection change the next commit brings (a cause lasts one commit). */
  let cause: SelectionCause | null = null;
  /** The cause came with its own selection.changed event (the focus policy has decided on it already). */
  let decided = false;
  /** The selection as of the last commit. */
  let selectionKey: string | null = null;
  /**
   * A pending rename: a name field was asked for (a request with an owner: F2, a double-click, Rename) but isn't there
   * yet (its panel's code is still downloading). Keys typed meanwhile are held for it, out of the canvas shortcuts'
   * reach (T would add a text, Backspace delete the connection), and handed over once it takes focus. Enter ends the
   * typing (`keys` null): the text waits for the field, and focus goes back to the item after it's written; Esc after
   * typing does the same (both finish and save, as in the field), Esc or Enter before any typing cancels. A press, focus
   * moving out of the canvas, a newer move, or the field resolving as gone (its panel's download failed) ends both the
   * hold and its field request.
   */
  let rename: { move: FocusMove; keys: { stop(): TypeAhead } | null; typed: TypeAhead } | null = null;

  /** The editor's mode (mode.ts): what the person is in the middle of, told to whoever reads it, as transitions. */
  let mode: EditorModeState = initialEditorMode;
  const modeListeners = new Set<(mode: EditorModeState, previous: EditorModeState) => void>();
  /** What a guide (a tutorial step) suggests: quick-add opens searched for this. Data only; it never moves focus. */
  let guide: { quickAdd?: string } | null = null;

  const journal = (entry: Omit<InteractionEntry, "seq">) => options.journal?.({ seq: ++seq, ...entry });

  function toMode(event: EditorModeEvent) {
    const previous = mode;
    mode = editorModeStep(mode, event);
    // Not journaled: the interaction journal records focus decisions, and its readers compare it whole.
    if (mode === previous) return;
    for (const l of modeListeners) l(mode, previous);
  }

  function phase(): InteractionPhase {
    if (menuState.open) return "menu-open";
    if (gestureState.active) return "gesture";
    if (recovery || (pendingMove(focus) && !parked)) return "focus-pending";
    return "idle";
  }

  function changed() {
    const next = phase();
    if (
      snapshot.menu !== menuState.open ||
      snapshot.roving !== focus.roving ||
      snapshot.keyboardSegment !== gestureState.keyboardSegment
    )
      snapshot = {
        menu: menuState.open,
        roving: focus.roving,
        keyboardSegment: gestureState.keyboardSegment,
      };
    if (next !== lastPhase) {
      lastPhase = next;
      port.publish(next);
    }
    for (const l of listeners) l();
  }

  function feedCamera() {
    const next = cameraMenuKind(menuState.open?.kind);
    if (next === cameraMenu) return;
    if (cameraMenu) camera?.dispatch({ type: "menu.closed" });
    if (next) camera?.dispatch({ type: "menu.opened", kind: next });
    cameraMenu = next;
  }

  function label(event: FocusEvent) {
    if (event.type === "menu.closed")
      return event.kind === "live" ? `live.menu.closed:${event.reason}` : `menu.closed:${event.reason}`;
    if (event.type === "menu.opened" && event.kind === "live") return "live.menu.opened";
    if (event.type === "selection.changed") return `selection.changed:${event.cause}`;
    if (event.type === "dialog.closed" && event.dialog !== "checks")
      return `dialog.closed:${event.dialog}${event.reason ? `:${event.reason}` : ""}`;
    if (event.type === "live.key") return `live.key:${event.key}:${event.action}`;
    return event.type;
  }

  /** Decides one event and starts its command. */
  function decide(event: FocusEvent, then?: Done) {
    const before = focus.pending;
    const decision = focusPolicy(focus, event);
    focus = decision.state;
    const command = decision.command;
    if ((import.meta.env.DEV || import.meta.env.VITE_E2E === "1") && options.journal)
      journal({ event: label(event), command: describe(command) });
    if (command.type === "focus") {
      retireRecovery("superseded");
      // A newer move replaces the pending one (its caller hears it didn't run).
      if (current && current.move === before) settle("superseded");
      cancelFrame?.();
      cancelFrame = null;
      parked = false;
      begun = false;
      current = { move: command, then };
      issuedAt = port.version?.() ?? 0;
      schedule(command);
    } else {
      if (focus.pending !== before && before) {
        // The policy retired the pending move (done, or input stood a retry down).
        cancelFrame?.();
        cancelFrame = null;
        if (current?.move === before) settle("superseded");
      }
      if (command.type === "recover") recover(command, then);
      else if (command.type === "roving") roving(command);
      else then?.(false);
    }
    // A pending rename lasts exactly as long as its field's move.
    if (rename && focus.pending !== rename.move) dropRename("superseded");
    changed();
  }

  /** Starts holding keys for a name field that isn't there yet (once per move). */
  function holdRename(move: FocusMove) {
    if (rename?.move === move || !port.holdKeys || move.target.kind !== "field" || !move.target.owner) return;
    dropRename("superseded");
    const next: NonNullable<typeof rename> = { move, keys: null, typed: { text: null } };
    rename = next;
    toMode({ type: "naming.requested", target: move.target.owner });
    next.keys = port.holdKeys((typed) => finishRename(next, typed));
    if ((import.meta.env.DEV || import.meta.env.VITE_E2E === "1") && options.journal)
      journal({ event: "rename.hold", command: describe(move) });
  }

  function finishRename(next: NonNullable<typeof rename>, typed: TypeAhead) {
    if (rename !== next) return;
    next.keys?.stop();
    next.keys = null;
    next.typed = typed;
    toMode({ type: "naming.done" });
    if (typed.text !== null) {
      if ((import.meta.env.DEV || import.meta.env.VITE_E2E === "1") && options.journal)
        journal({ event: `rename.typed:${typed.done}`, command: "keep" });
      return;
    }
    // Esc or Enter before anything was typed: the rename is over before its field came.
    decide({ type: "inspector.abandoned" });
  }

  /** Ends the pending rename, returning what it held. */
  function endRename(): TypeAhead | null {
    const r = rename;
    rename = null;
    if (!r) return null;
    return r.keys ? r.keys.stop() : r.typed;
  }

  function dropRename(why: "superseded" | "press" | "focus" | "unmount") {
    if (!rename) return;
    endRename();
    toMode({ type: "naming.done" });
    if ((import.meta.env.DEV || import.meta.env.VITE_E2E === "1") && options.journal)
      journal({ event: `rename.dropped:${why}`, command: "keep" });
  }

  /** The person left a pending rename: its held keys and its field request end together (a later commit can't revive it). */
  function abandonRename(why: "press" | "focus") {
    if (!rename) return;
    dropRename(why);
    decide({ type: "inspector.abandoned" });
  }

  /** Tells the current move's outcome, once. */
  function settle(result: NonNullable<InteractionEntry["result"]>) {
    const c = current;
    current = null;
    if (!c) return;
    if ((import.meta.env.DEV || import.meta.env.VITE_E2E === "1") && options.journal)
      journal({ event: "focus.result", command: describe(c.move), result });
    c.then?.(result === "focused" || result === "fallback");
  }

  function retireRecovery(result: NonNullable<InteractionEntry["result"]>) {
    const previous = recovery;
    recovery = null;
    if (!previous) return;
    previous.cancel();
    if ((import.meta.env.DEV || import.meta.env.VITE_E2E === "1") && options.journal)
      journal({ event: "focus.result", command: describe(previous.command), result });
    previous.then?.(result === "focused");
  }

  /** A user move already queued for this frame runs first. Only a remaining loss of focus needs recovery. */
  function recover(command: Extract<FocusCommand, { type: "recover" }>, then?: Done) {
    retireRecovery("superseded");
    const next = { command, then, cancel: () => {} };
    recovery = next;
    next.cancel = scheduler.frame(() => {
      if (disposed || recovery !== next) return;
      if (port.active() !== null || (command.ifGone && port.connected(command.ifGone))) {
        retireRecovery("kept");
      } else {
        const found = port.resolve(command.target);
        const focused = found.state === "ready" && put({ ...command, type: "focus" }, found.el);
        // Focus listeners can synchronously schedule a newer move.
        if (recovery === next) retireRecovery(focused ? "focused" : "gone");
      }
      changed();
    });
  }

  function schedule(move: FocusMove) {
    if (disposed) return;
    switch (move.when) {
      case "now":
      case "ready":
        return attempt(move);
      case "commit":
        // Run after the commit this event causes (rendered()), and its own focus moves; a frame at the latest.
        cancelFrame = scheduler.frame(() => attempt(move));
        return;
      case "frame":
      case "measured":
        cancelFrame = scheduler.frame(() => attempt(move));
        return;
      case "frames2":
        cancelFrame = scheduler.frame(() => {
          cancelFrame = scheduler.frame(() => attempt(move));
        });
        return;
    }
  }

  /** Tries the pending move now; it may finish, fall back, or keep waiting for its target. */
  function attempt(move: FocusMove) {
    if (disposed || focus.pending !== move) return;
    cancelFrame?.();
    cancelFrame = null;
    begun = true;
    if ((move.onlyIfLost && port.active() !== null) || (move.ifGone && port.connected(move.ifGone))) {
      settle("kept");
      return decide({ type: "focus.done" });
    }
    const found = port.resolve(move.target);
    if (found.state !== "gone" && found.node && found.node !== focus.roving && move.target.kind === "selection")
      decide({ type: "focus.resolved", id: found.node });
    if (found.state === "ready") {
      if (move.retry && port.active() === found.el) {
        settle("focused");
        return decide({ type: "focus.done" });
      }
      if (move.claim && !move.claim()) {
        settle("kept");
        return decide({ type: "focus.done" });
      }
      if (put(move, found.el, move.select)) {
        // A pending rename hands over what was typed meanwhile, as if it had been typed in the field.
        const typed = rename?.move === move ? endRename() : null;
        if (typed?.text != null) port.type?.(found.el, typed.text);
        if ((import.meta.env.DEV || import.meta.env.VITE_E2E === "1") && typed && options.journal)
          journal({
            event: "rename.handed",
            command: typed.text === null ? "keep" : `type${typed.done ? `:${typed.done}` : ""}`,
          });
        settle("focused");
        decide({ type: "focus.ran" });
        // Enter or Esc typed ahead: the name is done, as either does in the field (row N1).
        if (typed?.done && move.target.kind === "field" && move.target.owner) {
          toMode({ type: "naming.done" });
          decide({ type: "naming.done", flowId: move.target.owner });
        }
        return;
      }
    }
    // A fresh target the diagram hasn't committed yet is on its way, not gone.
    const arriving = found.state === "gone" && move.fresh && (port.version?.() ?? 0) === issuedAt;
    const waits =
      (move.when === "ready" || move.when === "measured") &&
      (found.state === "waiting" || found.state === "parked" || arriving);
    if (waits) {
      holdRename(move);
      const wasParked = parked;
      parked = found.state === "parked";
      // Measurement arrives on frames; a parked target arrives with a commit (rendered()).
      if (!parked) cancelFrame = scheduler.frame(() => attempt(move));
      if (wasParked !== parked) changed();
      return;
    }
    // Gone, not ready when its time came, or it wouldn't take focus: the fallback, else focus stays.
    const back = move.fallback ? port.resolve(move.fallback) : null;
    if (back?.state === "ready" && put(move, back.el)) settle("fallback");
    else settle("gone");
    decide({ type: "focus.done" });
  }

  function put(move: FocusMove, el: ElementHandle, select?: "all" | "end") {
    running = move;
    try {
      return port.focus(el, select);
    } finally {
      running = null;
    }
  }

  /** The Tab stop follows a target that resolves on a later frame (Undo from the toolbar). */
  function roving(command: Extract<FocusCommand, { type: "roving" }>) {
    cancelRoving?.();
    cancelRoving = null;
    const resolve = () => {
      cancelRoving = null;
      if (disposed) return;
      const found = port.resolve(command.target);
      if (found.state !== "gone" && found.node) decide({ type: "focus.resolved", id: found.node });
    };
    if (command.when === "now") resolve();
    else cancelRoving = scheduler.frame(resolve);
  }

  function selecting(next: SelectionCause) {
    cause = next;
    decided = false;
    if (next === "placement") camera?.placing();
  }

  function endGesture(seq: number, reason: GestureEndReason) {
    const t = gestures(gestureState, { type: "gesture.end", seq, reason });
    if (!t.ended) return;
    const how = gestureHow;
    gestureHow = null;
    gestureState = t.state;
    toMode({ type: "gesture.ended" });
    if ((import.meta.env.DEV || import.meta.env.VITE_E2E === "1") && options.journal)
      journal({ event: `gesture.end:${t.ended.kind}:${reason}`, command: t.ended.commit ? "commit" : "cancel" });
    // Publish before callbacks: capture loss and a commit's re-entrant events see this gesture as finished.
    changed();
    try {
      if (t.ended.commit) how?.commit(t.ended.preview);
      else if (!how?.capture || how.capture() === how.owner) how?.cancel?.();
    } finally {
      if (!gestureState.active) camera?.dispatch({ type: "gesture", on: false });
      decide({
        type: "gesture.ended",
        kind: t.ended.kind,
        reason,
        ...("edge" in t.ended.preview ? { edge: t.ended.preview.edge } : {}),
      });
    }
  }

  function closeMenu(reason: MenuCloseReason, seq?: number) {
    const t = menus(menuState, { type: "menu.close", reason, seq });
    if (!t.closed) return;
    menuState = t.state;
    feedCamera();
    toMode({ type: "menu.closed" });
    decide({
      type: "menu.closed",
      kind: t.closed.kind,
      reason: t.closed.reason,
      invoker: t.closed.invoker,
      platform: t.closed.platform,
    });
  }

  return {
    /** Space panning owns pointer input before any editing gesture can capture it. */
    get panHeld() {
      return panHeld;
    },
    setPanHeld(on: boolean) {
      if (on === panHeld) return;
      panHeld = on;
      if (on && gestureState.active) endGesture(gestureState.active.seq, "cancel");
      changed();
    },
    get gesture(): Gesture | null {
      return gestureState.active;
    },
    beginGesture(kind: GestureKind, preview: GesturePreview, how: GestureHandlers & { via: Gesture["via"] }) {
      // Hold pane work before closing a menu: there must be no gap between the two holds.
      if (gestureState.active) endGesture(gestureState.active.seq, "superseded");
      camera?.dispatch({ type: "gesture", on: true });
      closeMenu("gesture");
      const t = gestures(gestureState, { type: "gesture.start", kind, preview, via: how.via });
      gestureState = t.state;
      gestureHow = { ...how, owner: how.capture?.() };
      toMode({ type: "gesture.started" });
      if ((import.meta.env.DEV || import.meta.env.VITE_E2E === "1") && options.journal)
        journal({ event: `gesture.start:${kind}`, command: "keep" });
      changed();
      return t.started!.seq;
    },
    updateGesture(seq: number, preview: GesturePreview) {
      const t = gestures(gestureState, { type: "gesture.move", seq, preview });
      if (t.state === gestureState) return;
      gestureState = t.state;
      changed();
    },
    endGesture,
    /** Keys yield to menus, panning and gestures. Segment geometry belongs to the current route. */
    stepSegment(edge: string, k: number): number {
      if (panHeld || menuState.open || gestureState.active || selectionKey !== JSON.stringify([edge])) return -1;
      gestureState = gestures(gestureState, {
        type: "segment.step",
        edge,
        k,
        alone: true,
      }).state;
      changed();
      return gestureState.keyboardSegment?.k ?? 0;
    },
    /** Survives lazy edge-control remounts; stores route fingerprints, never selected-leg geometry. */
    observeSegmentRoute(edge: string, signature: string): boolean {
      const before = segmentRoute;
      segmentRoute = { edge, signature };
      if (!before || before.edge !== edge || before.signature === signature) {
        if (before?.edge === edge) segmentRoute.expected = before.expected;
        return false;
      }
      if (before.expected === signature || gestureState.keyboardSegment?.k === -1) return false;
      if (selectionKey !== JSON.stringify([edge])) return false;
      gestureState = gestures(gestureState, { type: "segment.reset", edge }).state;
      changed();
      return true;
    },
    expectSegmentRoute(edge: string, signature: string) {
      if (segmentRoute?.edge === edge) segmentRoute.expected = signature;
    },
    resetSegment(edge: string) {
      if (selectionKey !== JSON.stringify([edge])) return;
      gestureState = gestures(gestureState, { type: "segment.reset", edge }).state;
      changed();
    },
    /** Transient surfaces own Escape before selection. The newest eligible surface consumes one press. */
    attachEscape(close: () => boolean) {
      escapes.push(close);
      return () => {
        const index = escapes.lastIndexOf(close);
        if (index >= 0) escapes.splice(index, 1);
      };
    },
    /** Modal DOM owners handle their own key; naming precedes transient cards, even before its field mounts. */
    escape(overlay?: "dialog" | "menu") {
      if (overlay || menuState.open) return false;
      if (port.dismissPendingModal?.()) return true;
      if (gestureState.active) {
        endGesture(gestureState.active.seq, "escape");
        return true;
      }
      if (mode.value === "naming") {
        if (!rename?.keys) return false; // A mounted name field handles its own Escape.
        const typed = rename.keys.stop();
        finishRename(rename, { ...typed, done: "escape" });
        return true;
      }
      return [...escapes].reverse().some((close) => close());
    },
    /** Live attaches its readout layer while it shows hover cards; returns the detach. */
    attachReadouts(layer: ReadoutLayer) {
      readouts = layer;
      return () => {
        if (readouts === layer) readouts = null;
      };
    },
    /** Live's readout layer, if attached: canvas Tab bridges its cards, Esc and menus defer to it. */
    get readouts(): ReadoutLayer | null {
      return readouts;
    },
    /** The open menu or dialog, if any. */
    get menu(): OpenSurface<P> | null {
      return menuState.open;
    },
    /** The focus policy's state (the Tab stop, the pending move). */
    get state(): Readonly<FocusState> {
      return focus;
    },
    get phase(): InteractionPhase {
      return phase();
    },
    /** For useSyncExternalStore: a new object whenever something it holds changes. */
    getSnapshot() {
      return snapshot;
    },
    /** Narrow preview selectors: unrelated edges and the canvas shell keep their identity. */
    getConnectPreview() {
      const p = gestureState.active?.preview;
      return p?.kind === "connect" ? p : null;
    },
    getEdgePreview(edge: string) {
      const p = gestureState.active?.preview;
      return p?.kind === "edge.end" && p.edge === edge ? p : null;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    /** Opens a menu (or a dialog) over the canvas, replacing any that's open; returns its seq. */
    openMenu(
      kind: CanvasSurfaceKind,
      payload: P,
      how: { via?: MenuVia; platform?: Platform; invoker?: ElementHandle | null } = {},
    ) {
      if (gestureState.active) endGesture(gestureState.active.seq, "superseded");
      readouts?.dismiss();
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
      if (t.closed)
        decide({
          type: "menu.closed",
          kind: t.closed.kind,
          reason: t.closed.reason,
          invoker: t.closed.invoker,
          platform: t.closed.platform,
        });
      const o = t.opened!;
      toMode({ type: "menu.opened", kind: o.kind });
      decide({ type: "menu.opened", kind: o.kind, via: o.via, platform: o.platform });
      return o.seq;
    },
    /** Closes the open menu (`seq`: only if it's still that one) with its reason. */
    closeMenu,
    /** The camera to tell of menus (the canvas creates its camera after this controller). */
    attachCamera(next: InteractionCamera) {
      camera = next;
      if (cameraMenu) next.dispatch({ type: "menu.opened", kind: cameraMenu });
      if (gestureState.active) next.dispatch({ type: "gesture", on: true });
    },
    /** An event for the focus policy; `then` hears whether the move it caused put focus somewhere. */
    dispatch(event: FocusEvent, then?: Done) {
      if (event.type === "naming.done") toMode({ type: "naming.done" });
      if (event.type === "selection.changed") {
        cause = event.cause;
        decided = true;
      }
      decide(event, then);
    },
    /**
     * The cause of the selection change the next commit brings, declared where it's known: a click or React Flow's
     * own selection, the box, a placement (which the camera hears of too). Keyboard navigation, history steps and the
     * palette declare theirs with their selection.changed event instead.
     */
    selecting,
    /** For the placement hooks: the next selection (and pane change) comes from placing a new item. */
    placing: () => selecting("placement"),
    /**
     * A commit, with the selection it shows (CanvasView's layout effect). A changed selection is one
     * selection.changed event with its cause, for the focus policy (unless its source decided already) and for the
     * camera (a new, non-empty selection); every cause lasts one commit.
     */
    selectionCommitted(key: string, empty: boolean, annotating: string | null = null) {
      // Before the selection: a reader hearing the new annotation selected already knows its editor is open.
      toMode({ type: "annotating", id: annotating });
      const segment = gestureState.keyboardSegment;
      if (segmentRoute && key !== JSON.stringify([segmentRoute.edge])) segmentRoute = null;
      gestureState = gestures(gestureState, {
        type: "selection.committed",
        alone: segment && key === JSON.stringify([segment.edge]) ? segment.edge : undefined,
      }).state;
      if (segment !== gestureState.keyboardSegment) changed();
      const was = selectionKey;
      selectionKey = key;
      if (was !== key) toMode({ type: "selection", ids: JSON.parse(key) as string[] });
      const why = cause ?? "programmatic";
      const already = decided;
      cause = null;
      decided = false;
      if (was === null || was === key) return;
      if (!already) decide({ type: "selection.changed", cause: why });
      else if ((import.meta.env.DEV || import.meta.env.VITE_E2E === "1") && options.journal)
        journal({ event: `selection.committed:${why}`, command: "keep" });
      if (!empty)
        camera?.dispatch({ type: "selection.changed", cause: why === "placement" ? "placement" : "selection" });
    },
    /**
     * React committed (CanvasView's and the Inspector's layout effects): a move waiting for this commit runs, after
     * the commit's own focus moves, and a target waiting for its panel or measurement is tried again.
     */
    rendered() {
      const move = focus.pending;
      if (!move || disposed) return;
      if (move.when === "commit") {
        cancelFrame?.();
        cancelFrame = null;
        scheduler.microtask(() => attempt(move));
      } else if ((move.when === "ready" || (move.when === "measured" && begun)) && !move.retry) attempt(move);
    },
    /**
     * Space, Enter or Esc in live view: the level that takes it (liveKeys.ts), journaled as one live.key event for
     * the focus policy (row L1). The call site runs the level it's given.
     */
    liveKey(context: LiveKeyContext): LiveKeyAction {
      const action = liveKeys(context);
      decide({ type: "live.key", key: context.key, action });
      return action;
    },
    /**
     * A press or a key anywhere (window capture): a move's second attempt stands down. A press also ends a pending
     * rename (the person went elsewhere): later keys go where they point, nothing held is written, and its field won't
     * take focus.
     */
    input(kind: "key" | "press" = "key") {
      if (kind === "press") abandonRename("press");
      if (focus.pending?.retry) decide({ type: "input" });
    },
    /** Focus arrived on `el` (focusin): Tab or a script taking it out of the canvas ends a pending rename. */
    focusArrived(el: ElementHandle) {
      if (rename && !running && port.elsewhere?.(el)) abandonRename("focus");
      const field = port.field?.(el);
      if (rename?.keys && !field) return;
      toMode(field ? { type: "field.focused", ...field } : { type: "field.left" });
    },
    /** An annotation's editor opens (or closes: null), told before its document edit so no reader sees one alone. */
    annotating: (id: string | null) => toMode({ type: "annotating", id }),
    /** Focus left for nothing (focusout with no next element): no field is being edited. */
    focusLeft() {
      if (rename?.keys) return;
      toMode({ type: "field.left" });
    },
    /** Live's session: off, playing or paused (useLiveSessionState.ts tells it). */
    live(state: EditorModeState["live"]) {
      toMode({ type: "live", state });
    },
    /** The editor's mode (mode.ts). */
    get mode(): EditorModeState {
      return mode;
    },
    /** Hears each change of mode, with the one before it. */
    subscribeMode(listener: (mode: EditorModeState, previous: EditorModeState) => void) {
      modeListeners.add(listener);
      return () => void modeListeners.delete(listener);
    },
    /** What quick-add opens searched for (a tutorial step's guide), or null. */
    get guide() {
      return guide;
    },
    setGuide(next: { quickAdd?: string } | null) {
      guide = next;
    },
    /** The move running inside focus() right now (a focusin reads whether its caller reveals the target itself). */
    get focusing(): FocusMove | null {
      return running;
    },
    /** Where the pending move is going, while it waits for its frame (keyboard navigation goes on from there). */
    pendingTarget() {
      const t = pendingMove(focus)?.target;
      return t && (t.kind === "node" || t.kind === "edge" || t.kind === "readout") ? t : undefined;
    },
    /** Mounted: moves run. Returns the unmount (StrictMode mounts twice, so this pairs up rather than ends). */
    connect() {
      disposed = false;
      changed();
      return () => {
        if (gestureState.active) endGesture(gestureState.active.seq, "unmount");
        disposed = true;
        cancelFrame?.();
        cancelFrame = null;
        cancelRoving?.();
        cancelRoving = null;
        retireRecovery("superseded");
        dropRename("unmount");
        if (focus.pending) focus = { ...focus, pending: null };
        settle("superseded");
      };
    },
  };
}
