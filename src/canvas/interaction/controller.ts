import type { CameraEvent } from "../camera";
import { describe, focusPolicy, initialFocus, pendingMove } from "./focusPolicy";
import { liveKeys } from "./liveKeys";
import { cameraMenuKind, initialMenus, menus } from "./menus";
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
  let camera = options.camera;
  let focus: FocusState = initialFocus();
  /** The camera's view of the open menu (it hears of a change of kind only, as before). */
  let cameraMenu: "context" | "quickAdd" | null = null;
  const listeners = new Set<() => void>();
  let snapshot = { menu: null as OpenSurface<P> | null, roving: undefined as string | undefined };
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

  const journal = (entry: Omit<InteractionEntry, "seq">) => options.journal?.({ seq: ++seq, ...entry });

  function phase(): InteractionPhase {
    if (menuState.open) return "menu-open";
    if (recovery || (pendingMove(focus) && !parked)) return "focus-pending";
    return "idle";
  }

  function changed() {
    const next = phase();
    if (snapshot.menu !== menuState.open || snapshot.roving !== focus.roving)
      snapshot = { menu: menuState.open, roving: focus.roving };
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
    if (options.journal) journal({ event: label(event), command: describe(command) });
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
    changed();
  }

  /** Tells the current move's outcome, once. */
  function settle(result: NonNullable<InteractionEntry["result"]>) {
    const c = current;
    current = null;
    if (!c) return;
    if (options.journal) journal({ event: "focus.result", command: describe(c.move), result });
    c.then?.(result === "focused" || result === "fallback");
  }

  function retireRecovery(result: NonNullable<InteractionEntry["result"]>) {
    const previous = recovery;
    recovery = null;
    if (!previous) return;
    previous.cancel();
    if (options.journal) journal({ event: "focus.result", command: describe(previous.command), result });
    previous.then?.(result === "focused");
  }

  /** A user move already queued for this frame runs first. Only a remaining loss of focus needs recovery. */
  function recover(command: Extract<FocusCommand, { type: "recover" }>, then?: Done) {
    retireRecovery("superseded");
    const next = { command, then, cancel: () => {} };
    recovery = next;
    next.cancel = scheduler.frame(() => {
      if (disposed || recovery !== next) return;
      if (port.active() !== null || port.connected(command.ifGone)) {
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
        settle("focused");
        return decide({ type: "focus.ran" });
      }
    }
    // A fresh target the diagram hasn't committed yet is on its way, not gone.
    const arriving = found.state === "gone" && move.fresh && (port.version?.() ?? 0) === issuedAt;
    const waits =
      (move.when === "ready" || move.when === "measured") &&
      (found.state === "waiting" || found.state === "parked" || arriving);
    if (waits) {
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

  return {
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
      decide({ type: "menu.opened", kind: o.kind, via: o.via, platform: o.platform });
      return o.seq;
    },
    /** Closes the open menu (`seq`: only if it's still that one) with its reason. */
    closeMenu(reason: MenuCloseReason, seq?: number) {
      const t = menus(menuState, { type: "menu.close", reason, seq });
      if (!t.closed) return;
      menuState = t.state;
      feedCamera();
      decide({
        type: "menu.closed",
        kind: t.closed.kind,
        reason: t.closed.reason,
        invoker: t.closed.invoker,
        platform: t.closed.platform,
      });
    },
    /** The camera to tell of menus (the canvas creates its camera after this controller). */
    attachCamera(next: InteractionCamera) {
      camera = next;
      if (cameraMenu) next.dispatch({ type: "menu.opened", kind: cameraMenu });
    },
    /** An event for the focus policy; `then` hears whether the move it caused put focus somewhere. */
    dispatch(event: FocusEvent, then?: Done) {
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
    selectionCommitted(key: string, empty: boolean) {
      const was = selectionKey;
      selectionKey = key;
      const why = cause ?? "programmatic";
      const already = decided;
      cause = null;
      decided = false;
      if (was === null || was === key) return;
      if (!already) decide({ type: "selection.changed", cause: why });
      else if (options.journal) journal({ event: `selection.committed:${why}`, command: "keep" });
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
    /** A press or a key anywhere (window capture): a move's second attempt stands down. */
    input() {
      if (focus.pending?.retry) decide({ type: "input" });
    },
    /** The move running inside focus() right now (a focusin reads whether its caller reveals the target itself). */
    get focusing(): FocusMove | null {
      return running;
    },
    /** Where the pending move is going, while it waits for its frame (keyboard navigation goes on from there). */
    pendingTarget(): { kind: "node" | "edge"; id: string } | undefined {
      const t = pendingMove(focus)?.target;
      return t && (t.kind === "node" || t.kind === "edge") ? { kind: t.kind, id: t.id } : undefined;
    },
    /** Mounted: moves run. Returns the unmount (StrictMode mounts twice, so this pairs up rather than ends). */
    connect() {
      disposed = false;
      changed();
      return () => {
        disposed = true;
        cancelFrame?.();
        cancelFrame = null;
        cancelRoving?.();
        cancelRoving = null;
        retireRecovery("superseded");
        if (focus.pending) focus = { ...focus, pending: null };
        settle("superseded");
      };
    },
  };
}
