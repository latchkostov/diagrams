import { LIVE_BAR_SPACE } from "../../live/layout";
import type { CameraOwnership } from "../cameraOwnership";
import type { Viewport } from "../geometry/fit";
import { decide, initialPolicy, isPaneCause, pendingPhase } from "./panePolicy";
import type {
  CameraCommand,
  CameraEvent,
  CameraMode,
  CameraPhase,
  FitReason,
  LiveFitReason,
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

/**
 * Where a move stands in d3's schedule: `waiting` to start (on d3's next frame), `starting` (its start event is
 * being reported now), `running`, or `ended` (landed, interrupted by another move, or cancelled before it started).
 * `unknown` when the port can't read the schedule.
 */
export type MoveStatus = "waiting" | "starting" | "running" | "ended" | "unknown";

/** A move the port issued: `done` resolves when it lands (never, when another move stops it). */
export interface MoveHandle {
  done: Promise<unknown>;
  status(): MoveStatus;
}

/** React Flow and the DOM, as the controller sees them. Only the port touches the viewport. */
export interface CameraPort {
  viewport(): Viewport;
  /** Moves the view; `done` resolves when the transition ends (another move may stop it, leaving it unresolved). */
  move(target: Viewport, o: { duration: number; linear: boolean }): MoveHandle;
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
  /** Live's whole-diagram fit for its room (geometry.ts liveFitViewport), or null with nothing to fit. */
  liveFitTarget(room: { panel: boolean; card: boolean }): Viewport | null;
  /** A note's focus in view for Live's room (geometry.ts noteFitViewport). */
  noteFitTarget(focus: readonly string[], room: { panel: boolean; card: boolean }): Viewport | null;
  /**
   * The pane, the nodes and the selection as React Flow has measured them, as a sample to compare across frames;
   * null while React Flow's pane size lags the host's or something selected is unmeasured. A node just added
   * changes it until it's measured.
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
  cause?: RevealCause | FitReason | PaneCause | LiveFitReason | "user" | "quickAdd";
  /** Whether the view moved (a reveal that's already satisfied doesn't). */
  moved: boolean;
  from: Viewport;
  to?: Viewport;
}

/** Slow motion's camera geometry: the controller asks it when its policy says the take needs a view. */
export interface SlowmoCamera {
  /** The take's planned view (a fit of its path, or its first node at a readable zoom), or null. */
  plan(): Viewport | null;
  /**
   * The pane changed under the replay: `hold` stops a follow pan where it is (a paused replay keeps its view), a
   * view replans a playing, fitted take, null leaves it. `following`: slow motion still owns the view.
   */
  pane(following: boolean): Viewport | "hold" | null;
}

export interface CameraOptions {
  /** Reduced motion: durations through this (motionMs). */
  motion?: (ms: number) => number;
  journal?: (entry: JournalEntry) => void;
}

/** Durations (ms) and interpolation of each move. Pans are linear, so the zoom holds while they run. */
const MOVES = {
  /** Live's fits (as its React Flow fitView calls were), a note's close-up, slow motion's plan, pans and return. */
  liveFit: 700,
  note: 900,
  slowmoPlan: 900,
  follow: 700,
  restore: 900,
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
  let inFlight: { id: number; kind: "fit" | "pan"; target: Viewport; status: () => MoveStatus } | null = null;
  let moves = 0;
  /**
   * Only when the port can't read d3's schedule: our moves whose start React Flow hasn't reported yet, so a start
   * with no event is taken for ours. A move that hasn't started two frames after it was issued never will.
   */
  const awaitingStart: number[] = [];
  /** A move with no duration starts (and ends) inside port.move. */
  let issuing = false;
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
  /** Cancels for work waiting on the selection's measurement. */
  const measuring = new Set<() => void>();
  /** Reveal targets measured for the latest pane.settled, reused when its command runs. */
  let settledReveal: { withEdges: boolean; target: Viewport | null } | null = null;
  /** Slow motion's geometry while a live session has it mounted. */
  let slowmo: SlowmoCamera | null = null;

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
    issuing = true;
    let handle: MoveHandle;
    try {
      handle = port.move(target, { duration: ms, linear: o.linear });
    } finally {
      issuing = false;
    }
    inFlight = ms > 0 ? { id, kind: o.kind, target, status: handle.status } : null;
    if (ms > 0) watch(id);
    void Promise.resolve(handle.done).then(() => {
      if (inFlight?.id === id) inFlight = null;
      publish();
    });
    return handle.done;
  }

  /**
   * Follows the move in flight on rendered frames until it ends: one another writer stopped (its promise never
   * resolves) leaves nothing in flight. Without the schedule, a move that hasn't started two frames after it was
   * issued never will.
   */
  function watch(id: number) {
    let frames = 0;
    const known = inFlight?.status() !== "unknown";
    if (!known) awaitingStart.push(id);
    const step = () => {
      if (inFlight?.id !== id) return;
      frames++;
      if (known ? inFlight.status() !== "ended" : frames < 2) return void scheduler.frame(step);
      const i = awaitingStart.indexOf(id);
      if (!known && i < 0) return;
      if (i >= 0) awaitingStart.splice(i, 1);
      inFlight = null;
      publish();
    };
    scheduler.frame(step);
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
        const known =
          event.type === "pane.settled" && settledReveal?.withEdges === command.withEdges ? settledReveal : null;
        return pan(known ? known.target : port.revealTarget(base(), scope), duration, command.cause !== "checks", {
          command: "reveal",
          cause: command.cause,
        });
      }
      case "center":
        return pan(port.centerTarget(base()), MOVES.center, false, { command: "center" });
      // Live's moves, like its React Flow fitView calls: zoom interpolation, finishing through input.
      case "liveFit":
        return pan(port.liveFitTarget(command), MOVES.liveFit, false, { command: "liveFit", cause: command.reason });
      case "noteFit": {
        const duration = command.reason === "narration" ? MOVES.note : MOVES.liveFit;
        const target = port.noteFitTarget(command.focus, command);
        return pan(target, duration, false, { command: "noteFit", cause: command.reason });
      }
      case "slowmoPlan":
        return pan(slowmo?.plan() ?? null, MOVES.slowmoPlan, false, { command: "slowmoPlan" });
      case "slowmoPane": {
        const answer = slowmo?.pane(command.following) ?? null;
        if (answer !== "hold") return pan(answer, MOVES.slowmoPlan, false, { command: "slowmoPane" });
        // A follow pan may still be easing from before Pause: stop it where it is.
        const here = port.viewport();
        journal({ command: "stop", moved: false, from: here });
        generation++;
        early = null;
        return void move(here, 0, { linear: false, kind: "pan" });
      }
      // One move at a time: a follow pan waits for the plan's fit or the last pan to land.
      case "follow":
        return inFlight ? undefined : pan(command.view, MOVES.follow, false, { command: "follow" });
      case "restore":
        return pan(command.view, MOVES.restore, false, { command: "restore" });
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
      const work = policy.pending!;
      const facts = { selection: false, covered: false, coveredWithEdges: false, centreOff: false };
      // Measure only what the policy will ask about: a fitted (or narrated) view refits, Shift+2 holds still,
      // Live's own work and slow motion need no reveal.
      const owner = ownership.owner;
      const edit = policy.mode === "edit";
      const reveals =
        isPaneCause(work.cause) &&
        !policy.zoomPriority &&
        !policy.slowmo &&
        (work.cause !== "panel" || owner === "manual" || (edit && owner === "narration"));
      if (reveals) {
        const reveal = (withEdges: boolean) => {
          const target = port.revealTarget(from, { kind: "selection", withEdges, roomBelow: 0 });
          settledReveal = { withEdges, target };
          return target !== null;
        };
        if (work.cause !== "panel") facts.covered = reveal(false);
        else {
          facts.selection = port.hasSelection();
          if (facts.selection) facts.coveredWithEdges = reveal(true);
          else if (edit) facts.centreOff = port.centerTarget(from) !== null;
        }
      }
      dispatch({ type: "pane.settled", ...facts });
      settledReveal = null;
      return;
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
    /** A move is in flight (slow motion's follow pans wait for it before measuring the next one). */
    get moving() {
      return inFlight !== null;
    },
    /** Slow motion's geometry, while its session is mounted; returns the unmount. */
    slowmo(camera: SlowmoCamera) {
      slowmo = camera;
      return () => {
        if (slowmo === camera) slowmo = null;
      };
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
      if (issuing) return;
      const status = inFlight?.status();
      // Ours, starting now. Or someone else's animated move that started before ours did: ours replaces it when
      // it starts on this frame (d3 runs the newest transition).
      if (status === "starting" || status === "waiting") return;
      if (status === "unknown" && awaitingStart.length) {
        awaitingStart.shift();
        return;
      }
      // Someone else's programmatic move (the minimap, the zoom buttons) took the view over. d3 interrupted our
      // transition, or cancelled it before it started, and React Flow never resolves its promise: forget it,
      // without moving.
      takenOver();
      // It stops our fits too, except React Flow's own opening fit before anything has run.
      if (firstFit || interrupts > 0) interrupt();
      publish();
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
    whenSelectionMeasured(then: () => void, cancelled?: () => void) {
      waiters++;
      publish();
      let cancel: (() => void) | null = null;
      const stop = () => {
        if (!cancel) return;
        cancel();
        cancel = null;
        measuring.delete(stop);
        waiters--;
        cancelled?.();
        publish();
      };
      const step = () => {
        cancel = null;
        if (!port.selectionMeasured()) return void (cancel = scheduler.frame(step));
        measuring.delete(stop);
        waiters--;
        then();
        publish();
      };
      cancel = scheduler.frame(step);
      measuring.add(stop);
      return stop;
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
        // Work waiting for measurement ends with the canvas (quick-add releases its type-ahead capture).
        for (const stop of [...measuring]) stop();
      };
    },
  };

  function nudge(target: Viewport | null, duration: number) {
    interrupt();
    dispatch({ type: "user.moved" });
    pan(target, duration, true, { command: "nudge", cause: "user" });
    publish();
  }

  /** Another writer (or the user's gesture) replaced the move in flight; its promise may never resolve. */
  function takenOver() {
    inFlight = null;
    awaitingStart.length = 0;
  }

  function userMoved() {
    takenOver();
    interrupt();
    dispatch({ type: "user.moved" });
  }
}

/** Events that take the view afresh even when the owner stays the same. */
function claims(event: CameraEvent) {
  return event.type === "user.moved" || event.type === "zoom100";
}
