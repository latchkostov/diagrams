import { LIVE_BAR_SPACE } from "../../live/layout";
import type { CameraOwnership } from "../cameraOwnership";
import type { Viewport } from "../geometry/fit";
import { decide, initialPolicy, pendingPhase } from "./panePolicy";
import type {
  CameraCommand,
  CameraEvent,
  CameraMode,
  CameraPhase,
  FitReason,
  PaneCause,
  PolicyState,
  RevealCause,
} from "./types";

/** What a fit covers and how it keeps clear of the chrome (see useOverlayFit's fitAvoiding). */
export interface FitRequest {
  only?: ReadonlySet<string>;
  onlyEdges?: ReadonlySet<string>;
  maxZoom?: number;
  margin?: number;
  insets?: { top?: number; right?: number; bottom?: number; left?: number };
  duration?: number;
}

/** What a reveal brings into view. */
export type RevealScope =
  /** The selection (`withEdges`: with its connections); `roomBelow` keeps screen px under it (a label editor). */
  | { kind: "selection"; withEdges: boolean; roomBelow: number }
  /** These nodes (a check's finding names them). */
  | { kind: "nodes"; ids: readonly string[] }
  /** A node keyboard focus landed on, keeping `target`'s boundary name in view when the whole can't fit. */
  | { kind: "focus"; id: string; target: HTMLElement };

/**
 * The frame clock. Injected so unit tests drive frames by hand and a slow machine is only an interleaving:
 * nothing here waits on wall-clock time.
 */
export interface CameraScheduler {
  frame(run: () => void): () => void;
}

/** React Flow and the DOM, as the controller sees them. Only the port touches the viewport. */
export interface CameraPort {
  viewport(): Viewport;
  /** Moves the view; resolves when the transition ends (input may interrupt it, leaving it unresolved). */
  move(target: Viewport, o: { duration: number; linear: boolean }): Promise<unknown>;
  /** The overlay-aware fit's viewport, or null while the pane has no size. */
  fitTarget(request: FitRequest): Viewport | null;
  /** The smallest overlay-aware pan revealing `scope` from `base`, or null when it's in view and uncovered. */
  revealTarget(base: Viewport, scope: RevealScope): Viewport | null;
  /** The diagram's centre brought back into the pane from `base`, or null when it's well inside. */
  centerTarget(base: Viewport): Viewport | null;
  /** A node's centre at a readable zoom (the command palette's go-to). */
  goToTarget(base: Viewport, id: string): Viewport | null;
  /** 100% zoom about the pane's centre. */
  zoomTarget(base: Viewport, zoom: number): Viewport | null;
  /**
   * The pane and the selection as React Flow has measured them, as a sample to compare across frames; null
   * while React Flow's pane size lags the host's or something selected is unmeasured.
   */
  paneSample(): string | null;
  /** Whether everything selected (and visible) has been measured. */
  selectionMeasured(): boolean;
  hasSelection(): boolean;
  /** The measured gate: runs `run` once fonts, nodes and chrome have settled (a fit's refinement). */
  afterMeasured(run: () => unknown): void;
  interruptMeasured(): void;
  /** React Flow's own bootstrap fit, still waiting for its first measurements. */
  cancelBootstrapFit(): void;
  /** Readiness: `data-camera-state`, and `data-pane-pending` while pane work is armed. */
  publish(phase: CameraPhase, panePending: boolean): void;
  /** The first fit ran, or input stopped it (the title card may show its warnings). */
  fitted(): void;
}

/** One executed command, for the e2e journal and the unit tests. */
export interface JournalEntry {
  seq: number;
  command: CameraCommand["type"] | "anchor" | "nudge" | "stop";
  cause?: RevealCause | FitReason | PaneCause | "user" | "quickAdd";
  /** Whether the view moved (a reveal that's already satisfied doesn't). */
  moved: boolean;
  from: Viewport;
  to?: Viewport;
}

export interface CameraOptions {
  /** Reduced motion: durations through this (motionMs). */
  motion?: (ms: number) => number;
  journal?: (entry: JournalEntry) => void;
}

/** Durations (ms) and interpolation of each move. Pans are linear, so the zoom holds while they run. */
const MOVES = {
  reveal: 200,
  paneReveal: 250,
  checks: 250,
  center: 250,
  zoom100: 250,
  goTo: 300,
  anchor: 200,
};

export type CameraController = ReturnType<typeof createCameraController>;

/**
 * The single writer of the canvas viewport. Events go in with their cause; the pure policy (panePolicy.ts)
 * decides; this runs its commands one at a time. Pending pane work is data (the policy's `pending`), waits for
 * the pane to settle on rendered frames (never a timer), and survives menus. At most one move is in flight: a
 * new one replaces it, and reveals are computed from where the move in flight lands, never from its
 * intermediate frames.
 */
export function createCameraController(
  port: CameraPort,
  scheduler: CameraScheduler,
  ownership: CameraOwnership,
  options: CameraOptions = {},
) {
  const motion = options.motion ?? ((ms: number) => ms);
  let policy: PolicyState = initialPolicy();
  /** Bumped by input and by every command: earlier refinements and early fits stand down. */
  let generation = 0;
  /** Interruptions so far (React Flow's own opening fit is not one). */
  let interrupts = 0;
  /** Re-applies the latest fit to newly committed geometry until its measured refinement runs. */
  let early: (() => void) | null = null;
  let inFlight: { id: number; kind: "fit" | "pan"; target: Viewport } | null = null;
  let moves = 0;
  /** Our moves whose start React Flow hasn't reported yet (a start with no event is then ours). */
  let ownStarts = 0;
  let firstFit = false;
  let refinement = false;
  let waiters = 0;
  let pointerHeld = false;
  let settle: (() => void) | null = null;
  let lastSample: string | null = null;
  let live = false;
  let presenting = false;
  let seq = 0;
  /** A placement is under way: the next pane change or selection is its cause. */
  let placing = false;
  /** Unmounted: no frames are scheduled (StrictMode unmounts and mounts again, with events in between). */
  let disposed = false;
  const listeners = new Set<() => void>();

  const journal = (entry: Omit<JournalEntry, "seq">) => options.journal?.({ seq: ++seq, ...entry });
  /** Where the view is going: the move in flight's target, else the view now. */
  const base = () => inFlight?.target ?? port.viewport();

  /** Pane work waiting (or deferred by a menu), a refinement or reveal waiting, a move running, or idle. */
  function currentPhase(): CameraPhase {
    return pendingPhase(policy) ?? (refinement || waiters > 0 ? "pending" : inFlight ? "animating" : "idle");
  }
  function publish() {
    port.publish(currentPhase(), pendingPhase(policy) === "pending");
    for (const l of listeners) l();
  }

  function move(target: Viewport, duration: number, o: { linear: boolean; kind: "fit" | "pan" }): Promise<unknown> {
    const id = ++moves;
    const ms = motion(duration);
    inFlight = ms > 0 ? { id, kind: o.kind, target } : null;
    ownStarts++;
    const done = port.move(target, { duration: ms, linear: o.linear });
    void Promise.resolve(done).then(() => {
      if (inFlight?.id === id) inFlight = null;
      if (moves === id) ownStarts = 0;
      publish();
    });
    return done;
  }

  const same = (a: Viewport, b: Viewport) =>
    Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.zoom - b.zoom) < 1e-4;

  /** A pan (never a zoom) to `target`, from where the view is going. */
  function pan(
    target: Viewport | null,
    duration: number,
    linear: boolean,
    entry: Omit<JournalEntry, "seq" | "moved" | "from" | "to">,
  ) {
    const from = base();
    if (!target || same(from, target)) return journal({ ...entry, moved: false, from });
    generation++;
    early = null;
    journal({ ...entry, moved: true, from, to: target });
    void move(target, duration, { linear, kind: "pan" });
  }

  /** The overlay-aware fit: at once on the committed geometry, refined when the measurements settle. */
  function fit(request: FitRequest, animate: boolean, whole: boolean, reason: FitReason | "zoomToSelection") {
    const gen = ++generation;
    const claim = ownership.claim(whole ? "fit" : "manual");
    const valid = () => gen === generation && ownership.isCurrent(claim);
    const issue = (duration: number) => {
      const target = port.fitTarget(request);
      if (!target) return undefined;
      return move(target, duration, { linear: false, kind: "fit" });
    };
    if (options.journal)
      journal({
        command: whole ? "fit" : "zoomToSelection",
        cause: whole ? (reason as FitReason) : undefined,
        moved: true,
        from: base(),
        to: port.fitTarget(request) ?? undefined,
      });
    // Fit the committed geometry now. Fonts/chrome readiness only refines this view;
    // it must never leave an interactive canvas at its default transform.
    const immediate = (duration: number) => {
      if (valid()) void issue(duration);
    };
    early = () => immediate(0);
    immediate(animate ? (request.duration ?? 0) : 0);
    refinement = true;
    port.afterMeasured(() => {
      // Only the latest request runs (the measured gate keeps one); it may have lost the view meanwhile.
      refinement = false;
      if (!valid()) return publish();
      early = null;
      firstFit = true;
      const finished = issue(request.duration ?? 0);
      // Checks run independently of fonts/measurements. Their optional warning row arrives
      // after the opening viewport is computed, whichever asynchronous result wins the race.
      port.fitted();
      publish();
      return finished;
    });
  }

  function fitRequest(reason: FitReason): { request: FitRequest; animate: boolean } {
    const liveBar = live ? { bottom: LIVE_BAR_SPACE } : undefined;
    switch (reason) {
      case "command":
        return { request: { maxZoom: 1.25, duration: 300 }, animate: true };
      case "mode":
        return {
          request: {
            maxZoom: presenting ? 1.6 : 1.25,
            margin: presenting ? 64 : 40,
            insets: liveBar,
            duration: firstFit ? 350 : 0,
          },
          animate: false,
        };
      case "fullscreen":
        return { request: { maxZoom: 1.6, margin: 64, insets: liveBar, duration: 350 }, animate: false };
      case "reset":
        return { request: { maxZoom: 1.25, duration: 350 }, animate: false };
      case "checks":
      case "pane":
        return { request: { maxZoom: 1.25, margin: 40, duration: 250 }, animate: false };
    }
  }

  function execute(command: CameraCommand, event: CameraEvent) {
    switch (command.type) {
      case "fit": {
        const { request, animate } = fitRequest(command.reason);
        return fit(request, animate, true, command.reason);
      }
      case "zoomToSelection": {
        const e = event as Extract<CameraEvent, { type: "zoomToSelection" }>;
        // Never past 125% (no huge single node), clear of the panels; refined once the pane is measured,
        // so a pending Inspector reveal can't overwrite it at the old zoom.
        return fit(
          { only: e.nodes, onlyEdges: e.edges, maxZoom: 1.25, margin: 64, duration: 300 },
          true,
          false,
          "zoomToSelection",
        );
      }
      case "zoom100":
        return pan(port.zoomTarget(base(), 1), MOVES.zoom100, false, { command: "zoom100" });
      case "reveal": {
        const e = event as Extract<CameraEvent, { type: "reveal.requested" }>;
        const scope: RevealScope =
          event.type === "reveal.requested" && e.scope
            ? e.scope
            : { kind: "selection", withEdges: command.withEdges, roomBelow: 0 };
        const duration =
          event.type === "pane.settled" ? MOVES.paneReveal : command.cause === "checks" ? MOVES.checks : MOVES.reveal;
        // A Checks reveal keeps React Flow's default interpolation, as before; every other pan is linear.
        return pan(port.revealTarget(base(), scope), duration, command.cause !== "checks", {
          command: "reveal",
          cause: command.cause,
        });
      }
      case "center":
        return pan(port.centerTarget(base()), MOVES.center, false, { command: "center" });
    }
  }

  function dispatch(event: CameraEvent) {
    // Live claims the view for its narration directly: decide with the owner as it is now.
    policy = { ...policy, owner: ownership.owner };
    const decision = decide(policy, event);
    const claimed = decision.state.owner !== policy.owner || claims(event);
    policy = decision.state;
    // A move by hand or a command takes the view afresh: Live's deferred work checks its own claim. Fits
    // claim for themselves (their refinement runs only while that claim is current).
    if (claimed && !decision.commands.some((c) => c.type === "fit" || c.type === "zoomToSelection"))
      ownership.claim(policy.owner);
    for (const c of decision.commands) execute(c, event);
    reschedule();
  }

  /** Waits for two rendered frames that agree on the pane and selection, with no pointer held (a drag). */
  function reschedule() {
    if (pendingPhase(policy) === "pending") {
      if (!settle) settle = scheduler.frame(tick);
    } else {
      settle?.();
      settle = null;
      lastSample = null;
    }
    publish();
  }
  function tick() {
    settle = null;
    if (pendingPhase(policy) !== "pending" || disposed) return publish();
    const sample = pointerHeld ? null : port.paneSample();
    if (sample !== null && sample === lastSample) {
      lastSample = null;
      const from = base();
      return dispatch({
        type: "pane.settled",
        selection: port.hasSelection(),
        covered: port.revealTarget(from, { kind: "selection", withEdges: false, roomBelow: 0 }) !== null,
        coveredWithEdges: port.revealTarget(from, { kind: "selection", withEdges: true, roomBelow: 0 }) !== null,
        centreOff: port.centerTarget(from) !== null,
      });
    }
    lastSample = sample;
    settle = scheduler.frame(tick);
  }

  /** Input anywhere: refinements and early fits stop, and so does a fit in flight (a pan in flight finishes). */
  function interrupt() {
    generation++;
    interrupts++;
    early = null;
    refinement = false;
    port.interruptMeasured();
    port.cancelBootstrapFit();
    if (inFlight?.kind === "fit") {
      inFlight = null;
      const here = port.viewport();
      journal({ command: "stop", moved: false, from: here });
      void move(here, 0, { linear: false, kind: "fit" });
    }
    port.fitted();
  }

  return {
    dispatch,
    /** The pane policy's state (Live reads the latest pane change's cause). */
    get state(): Readonly<PolicyState> {
      return policy;
    },
    get phase(): CameraPhase {
      return currentPhase();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    /** A press, wheel, key or context menu anywhere (window capture, before anything handles it). */
    input(kind: "press" | "release" | "other" = "other") {
      if (kind === "release") {
        pointerHeld = false;
        return reschedule();
      }
      if (kind === "press") pointerHeld = true;
      interrupt();
      dispatch({ type: "input" });
    },
    /** Interrupts fits without being input (a node focused, a hover over a node while a fit is early). */
    interrupt() {
      interrupt();
      publish();
    },
    /** A fit is still re-applying itself to new geometry (hover over a node then stops it). */
    get fitting() {
      return early !== null;
    },
    /** React Flow committed new nodes or edges: an early fit follows them before paint. */
    committed() {
      early?.();
    },
    /** React Flow reported a move start: `user` when it came from an input event. */
    moveStarted(user: boolean) {
      if (user) return userMoved();
      if (ownStarts > 0) {
        ownStarts--;
        return;
      }
      // Someone else's programmatic move (Live, slow motion, the minimap, the zoom buttons): it stops our fits,
      // except React Flow's own opening fit before anything has run.
      if (firstFit || interrupts > 0) {
        interrupt();
        publish();
      }
    },
    /** A pan or zoom by hand (React Flow reported its event; d3 stopped any transition). */
    userMoved,
    /** A node drag starting: fits stop and the view is the user's, but a pan in flight finishes. */
    dragStarted() {
      interrupt();
      dispatch({ type: "user.moved" });
    },
    mode(next: { live: boolean; presenting: boolean }) {
      live = next.live;
      presenting = next.presenting;
      const mode: CameraMode = presenting ? "present" : live ? "live" : "edit";
      dispatch({ type: "mode.changed", mode });
    },
    /** Holds the camera's readiness for work about to arrive (a pointer-up's Inspector change); returns its release. */
    hold() {
      let held = true;
      waiters++;
      publish();
      return () => {
        if (!held) return;
        held = false;
        waiters--;
        publish();
      };
    },
    /** Waits (on frames) until the selection is measured, then runs `then`: the work that follows a selection. */
    whenSelectionMeasured(then: () => void) {
      waiters++;
      publish();
      let cancel: (() => void) | null = null;
      const step = () => {
        cancel = null;
        if (disposed) return;
        if (!port.selectionMeasured()) return void (cancel = scheduler.frame(step));
        waiters--;
        then();
        publish();
      };
      cancel = scheduler.frame(step);
      return () => {
        if (!cancel) return;
        cancel();
        waiters--;
        publish();
      };
    },
    /** Quick-add's outline and menu need room: the pan that makes it (no change of owner). */
    anchor(target: Viewport | null) {
      pan(target, MOVES.anchor, true, { command: "anchor", cause: "quickAdd" });
      publish();
    },
    /** A pan asked for by hand, by screen px (the HTML viewer's arrow keys). */
    panByHand(dx: number, dy: number, duration: number) {
      const from = base();
      nudge({ x: from.x + dx, y: from.y + dy, zoom: from.zoom }, duration);
    },
    /** A zoom asked for by hand, about the pane's centre (the HTML viewer's +, − and Shift+0). */
    zoomByHand(zoom: number | ((current: number) => number), duration: number) {
      const from = base();
      nudge(port.zoomTarget(from, typeof zoom === "number" ? zoom : zoom(from.zoom)), duration);
    },
    /** The command palette's go-to: a node at a readable zoom. The view is the user's after it. */
    goTo(id: string) {
      dispatch({ type: "user.moved" });
      pan(port.goToTarget(base(), id), MOVES.goTo, false, { command: "reveal", cause: "palette" });
      publish();
    },
    /** The next pane change or selection comes from placing a new item (quick-add, a drop, the rail). */
    placing() {
      placing = true;
    },
    /** Whether the commit being read was a placement (and forgets it: a cause lasts one commit). */
    takePlacement() {
      const was = placing;
      placing = false;
      return was;
    },
    /** Mounted: work runs. Returns the unmount (StrictMode mounts twice, so this pairs up rather than ends). */
    connect() {
      disposed = false;
      reschedule();
      return () => {
        disposed = true;
        settle?.();
        settle = null;
      };
    },
  };

  function nudge(target: Viewport | null, duration: number) {
    interrupt();
    dispatch({ type: "user.moved" });
    pan(target, duration, true, { command: "nudge", cause: "user" });
    publish();
  }

  function userMoved() {
    interrupt();
    inFlight = null;
    ownStarts = 0;
    dispatch({ type: "user.moved" });
  }
}

/** Events that take the view afresh even when the owner stays the same. */
function claims(event: CameraEvent) {
  return event.type === "user.moved" || event.type === "zoom100";
}
