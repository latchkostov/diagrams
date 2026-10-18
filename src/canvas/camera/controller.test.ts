import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createCameraOwnership } from "../cameraOwnership";
import type { Viewport } from "../geometry/fit";
import {
  createCameraController,
  type CameraPort,
  type JournalEntry,
  type MoveStatus,
  type RevealScope,
} from "./controller";
import type { CameraPhase } from "./types";

/**
 * A deterministic stand-in for React Flow, d3 and the frame clock. It follows d3-transition's rules: an animated
 * move is scheduled and starts on the next frame, and its start interrupts the transition running (whose promise
 * never resolves) and cancels older scheduled ones (which never start). An immediate move (no duration) interrupts
 * and cancels everything and starts at once. Every start is reported to the canvas (onMoveStart without an event).
 * A move leaves the view at an intermediate point until it lands, so a reveal computed from the live view is caught.
 */
type Transition = {
  id: number;
  target: Viewport;
  state: MoveStatus;
  ours: boolean;
  resolve: () => void;
};
function harness() {
  const frames: (() => void)[] = [];
  const view = { current: { x: 0, y: 0, zoom: 1 } as Viewport };
  const transitions: Transition[] = [];
  let ids = 0;
  const moves: { target: Viewport; duration: number; linear: boolean }[] = [];
  const revealBases: Viewport[] = [];
  /**
   * Reveals computed from an intermediate frame of our move in flight. (Another writer's destination is unknown:
   * a reveal replaces its move where it stands.)
   */
  let midMove = 0;
  /** Reveals computed from a target nothing is moving to any more (a move another writer replaced). */
  let stale = 0;
  const same = (a: Viewport, b: Viewport) => a.x === b.x && a.y === b.y && a.zoom === b.zoom;
  const phases: CameraPhase[] = [];
  const journal: JournalEntry[] = [];
  const env = {
    sample: "1000x800" as string | null,
    covered: false,
    measured: true,
    selection: true,
    refine: null as (() => unknown) | null,
    panePending: false,
    fitted: 0,
    /** Whether the port can read d3's schedule (React Flow's internals as we know them). */
    status: true,
  };
  /** React Flow reports every move start to the canvas (onMoveStart without an event). */
  const started = { report: (_user: boolean) => {} };
  const end = (t: Transition) => {
    t.state = "ended";
    transitions.splice(transitions.indexOf(t), 1);
  };
  const running = () => transitions.find((t) => t.state === "running") ?? null;
  /** d3's start: interrupt the running transition, cancel older scheduled ones, report, then run. */
  const begin = (t: Transition) => {
    if (t.state !== "waiting") return;
    for (const o of [...transitions]) if (o !== t && (o.state === "running" || o.id < t.id)) end(o);
    t.state = "starting";
    started.report(false);
    if (t.state !== "starting") return;
    t.state = "running";
    const from = view.current;
    // Mid-way: the zoom and position of an intermediate frame.
    view.current = {
      x: (from.x + t.target.x) / 2,
      y: (from.y + t.target.y) / 2,
      zoom: (from.zoom + t.target.zoom) / 2,
    };
  };
  const schedule = (target: Viewport, ours: boolean) => {
    let resolve = () => {};
    const done = new Promise<void>((r) => (resolve = r));
    const t: Transition = { id: ++ids, target, state: "waiting", ours, resolve };
    transitions.push(t);
    frames.push(() => begin(t));
    return { t, done };
  };
  /** zoom.transform without a transition: everything scheduled or running stops, and it applies at once. */
  const immediate = (target: Viewport) => {
    for (const o of [...transitions]) end(o);
    started.report(false);
    view.current = target;
  };
  const port: CameraPort = {
    viewport: () => view.current,
    move(target, o) {
      moves.push({ target, ...o });
      if (o.duration <= 0) {
        immediate(target);
        return { done: Promise.resolve(true), status: () => (env.status ? "ended" : "unknown") };
      }
      const { t, done } = schedule(target, true);
      return { done, status: () => (env.status ? t.state : "unknown") };
    },
    fitTarget: () => ({ x: 5, y: 5, zoom: 0.8 }),
    revealTarget(base: Viewport, _scope: RevealScope) {
      revealBases.push(base);
      const r = running();
      if (r?.ours && same(base, view.current) && !same(base, r.target)) midMove++;
      if (!transitions.some((t) => t.ours) && !same(base, view.current)) stale++;
      return env.covered ? { x: base.x - 40, y: base.y, zoom: base.zoom } : null;
    },
    centerTarget: () => null,
    goToTarget: (base) => ({ ...base, x: base.x + 100 }),
    zoomTarget: (base, zoom) => ({ ...base, zoom }),
    liveFitTarget: (room) => ({ x: room.panel ? -440 : room.card ? -400 : 11, y: 11, zoom: 0.9 }),
    noteFitTarget: (focus, room) => ({
      x: 20 * focus.length - (room.panel ? 440 : room.card ? 400 : 0),
      y: 21,
      zoom: 1,
    }),
    paneSample: () => env.sample,
    selectionMeasured: () => env.measured,
    hasSelection: () => env.selection,
    afterMeasured(run) {
      env.refine = run;
    },
    interruptMeasured() {
      env.refine = null;
    },
    cancelBootstrapFit() {},
    publish(phase, panePending) {
      phases.push(phase);
      env.panePending = panePending;
    },
    fitted() {
      env.fitted++;
    },
  };
  const ownership = createCameraOwnership();
  const camera = createCameraController(
    port,
    {
      frame(run) {
        frames.push(run);
        return () => {
          const i = frames.indexOf(run);
          if (i >= 0) frames.splice(i, 1);
        };
      },
    },
    ownership,
    { journal: (e) => journal.push(e) },
  );
  started.report = (user) => camera.moveStarted(user);
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) for (const run of frames.splice(0)) run();
  };
  /** Time passes until the latest transition lands: it starts if it hasn't, then ends; the promise callbacks run. */
  const finish = async () => {
    for (const t of [...transitions].sort((a, b) => a.id - b.id)) begin(t);
    const r = running();
    if (r) {
      view.current = r.target;
      end(r);
      r.resolve();
    }
    await Promise.resolve();
    await Promise.resolve();
  };
  const refine = async () => {
    const run = env.refine;
    env.refine = null;
    run?.();
    await Promise.resolve();
  };
  return {
    camera,
    ownership,
    env,
    view,
    moves,
    revealBases,
    phases,
    journal,
    tick,
    finish,
    refine,
    frames,
    /** Our transition still scheduled or running. */
    ours: () => transitions.find((t) => t.ours) ?? null,
    /** Any transition scheduled or running. */
    active: () => transitions.at(-1) ?? null,
    /** Another writer's immediate move (Live's old setViewport, the minimap, the zoom buttons). */
    foreignNow: (to?: Viewport) => immediate(to ?? { ...view.current, x: view.current.x + 7 }),
    /** Another writer's animated move: it starts on the next frame. */
    foreignAnimated: (to?: Viewport) => void schedule(to ?? { ...view.current, x: view.current.x + 7 }, false),
    /** d3 cancels our scheduled or running transition and nobody reports a start (the port's last resort). */
    cancelSilently: () => {
      for (const t of [...transitions]) end(t);
    },
    midMove: () => midMove,
    stale: () => stale,
  };
}

describe("camera controller", () => {
  it("holds a panel change as pending data until two frames agree, then refits once", async () => {
    const h = harness();
    h.camera.dispatch({ type: "pane.changed", cause: "panel" });
    expect(h.camera.phase).toBe("pending");
    expect(h.env.panePending).toBe(true);
    expect(h.moves).toHaveLength(0);
    h.tick();
    expect(h.moves).toHaveLength(0);
    h.tick();
    // The immediate fit at once, the refinement once measured.
    expect(h.moves).toHaveLength(1);
    expect(h.env.panePending).toBe(false);
    expect(h.camera.phase).toBe("pending");
    await h.refine();
    expect(h.moves).toHaveLength(2);
    expect(h.camera.phase).toBe("animating");
    await h.finish();
    expect(h.camera.phase).toBe("idle");
    h.tick(5);
    expect(h.moves).toHaveLength(2);
    expect(h.journal.filter((e) => e.command === "fit").map((e) => e.cause)).toEqual(["pane"]);
  });

  it("waits for React Flow's pane size and a released pointer (no timer)", () => {
    const h = harness();
    h.env.sample = null;
    h.camera.dispatch({ type: "pane.changed", cause: "panel" });
    h.tick(10);
    expect(h.moves).toHaveLength(0);
    h.env.sample = "900x800";
    h.camera.input("press");
    h.tick(10);
    expect(h.moves).toHaveLength(0);
    h.camera.input("release");
    h.tick(2);
    expect(h.moves).toHaveLength(1);
  });

  it("defers pending work while a menu is open, then runs it once (deferred is not idle)", () => {
    const h = harness();
    h.camera.dispatch({ type: "pane.changed", cause: "panel" });
    h.camera.dispatch({ type: "menu.opened", kind: "context" });
    expect(h.camera.phase).toBe("deferred");
    expect(h.env.panePending).toBe(false);
    h.tick(10);
    expect(h.moves).toHaveLength(0);
    h.camera.dispatch({ type: "menu.closed" });
    h.camera.dispatch({ type: "menu.opened", kind: "context" });
    h.tick(10);
    h.camera.dispatch({ type: "menu.closed" });
    h.tick(2);
    expect(h.journal.filter((e) => e.command === "fit")).toHaveLength(1);
    h.camera.dispatch({ type: "menu.opened", kind: "context" });
    h.camera.dispatch({ type: "menu.closed" });
    h.tick(10);
    expect(h.journal.filter((e) => e.command === "fit")).toHaveLength(1);
  });

  it("reveals from where the move in flight lands, never from its intermediate frame", () => {
    const h = harness();
    h.env.covered = true;
    h.camera.dispatch({ type: "reveal.requested", cause: "placement" });
    h.tick();
    expect(h.moves).toHaveLength(1);
    const first = h.moves[0].target;
    expect(h.moves[0].linear).toBe(true);
    // The view is mid-way now; the next reveal starts from the first one's target.
    expect(h.view.current).not.toEqual(first);
    h.camera.dispatch({ type: "reveal.requested", cause: "navigation" });
    expect(h.revealBases[1]).toEqual(first);
    expect(h.moves[1].target.zoom).toBe(first.zoom);
  });

  it("a placement while a panel refit is pending reveals only the placement", () => {
    const h = harness();
    h.env.covered = true;
    h.camera.dispatch({ type: "pane.changed", cause: "panel" });
    h.camera.placing();
    expect(h.camera.takePlacement()).toBe(true);
    h.camera.dispatch({ type: "selection.changed", cause: "placement" });
    h.tick(2);
    expect(h.journal.map((e) => `${e.command}:${e.cause}`)).toEqual(["reveal:placement"]);
  });

  it("Zoom to selection wins over a reveal still waiting for measurement", () => {
    const h = harness();
    h.env.covered = true;
    h.env.measured = false;
    h.camera.whenSelectionMeasured(() => h.camera.dispatch({ type: "reveal.requested", cause: "placement" }));
    expect(h.camera.phase).toBe("pending");
    h.camera.dispatch({ type: "zoomToSelection", nodes: new Set(["a"]), edges: new Set() });
    h.env.measured = true;
    h.tick(3);
    expect(h.journal.map((e) => e.command)).toEqual(["zoomToSelection"]);
    expect(h.ownership.owner).toBe("manual");
  });

  it("input stops a fit in flight and its refinement; a pan in flight finishes", async () => {
    const h = harness();
    h.camera.dispatch({ type: "fit", reason: "command" });
    expect(h.active()).not.toBeNull();
    h.camera.input("press");
    // Stopped where it stood (a zero-length move), and the refinement no longer moves anything.
    expect(h.moves.at(-1)?.duration).toBe(0);
    await h.refine();
    expect(h.moves).toHaveLength(2);
    h.env.covered = true;
    h.camera.dispatch({ type: "reveal.requested", cause: "navigation" });
    const pans = h.moves.length;
    h.camera.input("other");
    expect(h.moves).toHaveLength(pans);
    expect(h.camera.phase).toBe("animating");
  });

  it("tells its own move starts from others' (Live, the minimap), which stop its fits", async () => {
    const h = harness();
    h.camera.dispatch({ type: "fit", reason: "command" });
    // Its own fit starting (on d3's next tick) is not an interruption.
    h.tick();
    expect(h.env.refine).not.toBeNull();
    // Before anything has run or been interrupted, a foreign start is React Flow's own opening fit.
    h.camera.moveStarted(false);
    expect(h.env.refine).not.toBeNull();
    await h.finish();
    h.camera.input("other");
    h.camera.dispatch({ type: "fit", reason: "command" });
    h.tick();
    expect(h.env.refine).not.toBeNull();
    // Once the fit has landed, a start without an event is someone else's (the minimap): it stops the fit.
    await h.finish();
    h.foreignNow();
    expect(h.env.refine).toBeNull();
  });

  it("a foreign zoom that interrupts a pan leaves nothing in flight, and the next reveal starts from the real view", () => {
    const h = harness();
    h.env.covered = true;
    h.camera.dispatch({ type: "reveal.requested", cause: "placement" });
    h.tick();
    expect(h.camera.phase).toBe("animating");
    // The zoom buttons (React Flow's own zoomIn) replace the pan; its promise never resolves.
    h.foreignNow({ x: 3, y: 4, zoom: 1.5 });
    h.camera.userMoved();
    expect(h.camera.phase).toBe("idle");
    h.camera.dispatch({ type: "input" });
    h.camera.dispatch({ type: "reveal.requested", cause: "navigation" });
    expect(h.revealBases.at(-1)).toEqual({ x: 3, y: 4, zoom: 1.5 });
    expect(h.moves.at(-1)?.target.zoom).toBe(1.5);
  });

  it("another writer's move that interrupts a pan clears it too", () => {
    const h = harness();
    h.env.covered = true;
    h.camera.dispatch({ type: "reveal.requested", cause: "placement" });
    h.tick();
    expect(h.camera.phase).toBe("animating");
    h.foreignNow({ x: 9, y: 9, zoom: 0.7 });
    expect(h.camera.phase).toBe("idle");
    h.camera.dispatch({ type: "reveal.requested", cause: "navigation" });
    expect(h.revealBases.at(-1)).toEqual({ x: 9, y: 9, zoom: 0.7 });
  });

  it("unmounting cancels work waiting for measurement (quick-add releases its key capture)", () => {
    const h = harness();
    h.env.measured = false;
    let ran = 0;
    let cancelled = 0;
    const unmount = h.camera.connect();
    h.camera.whenSelectionMeasured(
      () => ran++,
      () => cancelled++,
    );
    expect(h.camera.phase).toBe("pending");
    unmount();
    h.env.measured = true;
    h.tick(3);
    expect([ran, cancelled]).toEqual([0, 1]);
    expect(h.camera.phase).toBe("idle");
  });

  it("measures only what the policy asks: a fitted refit needs no reveal geometry", () => {
    const h = harness();
    h.camera.dispatch({ type: "pane.changed", cause: "panel" });
    h.tick(2);
    expect(h.revealBases).toHaveLength(0);
    h.env.covered = true;
    h.camera.dispatch({ type: "pane.changed", cause: "selection" });
    h.tick(2);
    // One measurement, reused by the reveal it decided.
    expect(h.revealBases).toHaveLength(1);
    expect(h.journal.at(-1)?.command).toBe("reveal");
  });

  it("forgets a move that never started (d3 pre-empted it), so readiness can't stick on animating", () => {
    const h = harness();
    h.env.covered = true;
    h.camera.dispatch({ type: "reveal.requested", cause: "placement" });
    // d3 drops it and React Flow never reports a start.
    h.cancelSilently();
    h.tick(2);
    expect(h.camera.phase).toBe("idle");
  });

  it("without d3's schedule, still forgets a move that never started", () => {
    const h = harness();
    h.env.status = false;
    h.env.covered = true;
    h.camera.dispatch({ type: "reveal.requested", cause: "placement" });
    h.cancelSilently();
    h.tick(2);
    expect(h.camera.phase).toBe("idle");
  });

  it("another writer's immediate move before ours started cancels ours: readiness doesn't stick on animating", async () => {
    // The minimal counterexample of the interleaving model: a fit and its refinement are both waiting for d3's next
    // frame when the minimap moves the view. d3 cancels both, and the minimap's start is not ours.
    const h = harness();
    h.camera.dispatch({ type: "fit", reason: "command" });
    await h.refine();
    h.foreignNow({ x: 2, y: 3, zoom: 0.9 });
    expect(h.ours()).toBeNull();
    expect(h.camera.phase).toBe("idle");
    h.env.covered = true;
    h.camera.dispatch({ type: "reveal.requested", cause: "navigation" });
    expect(h.revealBases.at(-1)).toEqual({ x: 2, y: 3, zoom: 0.9 });
  });

  it("another writer's animated move that starts just before ours doesn't take ours for its own", async () => {
    const h = harness();
    h.env.covered = true;
    h.foreignAnimated();
    h.camera.dispatch({ type: "reveal.requested", cause: "placement" });
    // Both start on this frame: the other move first, then ours, which replaces it.
    h.tick();
    expect(h.ours()?.state).toBe("running");
    expect(h.camera.phase).toBe("animating");
    const target = h.moves[0].target;
    h.camera.dispatch({ type: "reveal.requested", cause: "navigation" });
    expect(h.revealBases.at(-1)).toEqual(target);
    await h.finish();
    h.tick();
    expect(h.camera.phase).toBe("idle");
  });

  it("Live's panel refit waits for the pane, then fits the room in one 700 ms move (no timer)", async () => {
    const h = harness();
    h.camera.mode({ live: true, presenting: false });
    await h.refine();
    await h.finish();
    const mark = h.journal.length;
    h.camera.dispatch({ type: "live.panel", open: true });
    expect(h.camera.phase).toBe("pending");
    h.tick();
    expect(h.journal.length).toBe(mark);
    h.tick();
    expect(h.journal.slice(mark).map((e) => `${e.command}:${e.cause}`)).toEqual(["liveFit:panel"]);
    expect(h.moves.at(-1)).toEqual({ target: { x: -440, y: 11, zoom: 0.9 }, duration: 700, linear: false });
    expect(h.camera.phase).toBe("animating");
    // Input doesn't stop it (as Live's own fits never did); it lands.
    h.camera.input("other");
    await h.finish();
    h.tick();
    expect(h.camera.phase).toBe("idle");
  });

  it("a note's focus fits in 900 ms; its later refits for the room take 700 ms", () => {
    const h = harness();
    h.camera.dispatch({ type: "narration", focus: ["a", "b"] });
    h.tick(2);
    expect(h.moves.at(-1)).toMatchObject({ target: { x: 40, y: 21, zoom: 1 }, duration: 900 });
    expect(h.ownership.owner).toBe("narration");
    h.camera.dispatch({ type: "live.card", open: true });
    h.tick(2);
    expect(h.journal.at(-1)).toMatchObject({ command: "noteFit", cause: "card" });
    expect(h.moves.at(-1)?.duration).toBe(700);
  });

  it("a node Live added is fitted once React Flow has measured it", () => {
    const h = harness();
    h.camera.dispatch({ type: "live.added", panel: true });
    // A node just added changes the sample until it's measured.
    for (const sample of ["1000x800:3/2", "1000x800:4/3", "1000x800:4/4"]) {
      h.env.sample = sample;
      h.tick();
    }
    expect(h.journal).toHaveLength(0);
    h.tick();
    expect(h.journal.map((e) => `${e.command}:${e.cause}`)).toEqual(["liveFit:added"]);
  });

  it("slow motion: its take plans once the pane settles, follow pans wait for the move in flight, a pan by hand ends following", async () => {
    const h = harness();
    h.camera.mode({ live: true, presenting: false });
    await h.refine();
    await h.finish();
    const asked: boolean[] = [];
    h.camera.slowmo({
      plan: () => ({ x: 50, y: 50, zoom: 0.7 }),
      pane: (following) => (asked.push(following), "hold"),
    });
    h.camera.dispatch({ type: "slowmo", on: true });
    h.camera.dispatch({ type: "slowmo.take" });
    h.tick(2);
    expect(h.moves.at(-1)).toMatchObject({ target: { x: 50, y: 50, zoom: 0.7 }, duration: 900 });
    expect(h.camera.moving).toBe(true);
    const follow = { x: 60, y: 50, zoom: 0.7 };
    h.camera.dispatch({ type: "slowmo.follow", view: follow });
    expect(h.moves.at(-1)?.target).toEqual({ x: 50, y: 50, zoom: 0.7 });
    await h.finish();
    h.camera.dispatch({ type: "slowmo.follow", view: follow });
    expect(h.moves.at(-1)).toMatchObject({ target: follow, duration: 700 });
    // A paused replay's pane changed: the pan in flight stops where it is.
    h.camera.dispatch({ type: "pane.changed", cause: "panel" });
    h.tick(2);
    expect(asked).toEqual([true]);
    expect(h.moves.at(-1)?.duration).toBe(0);
    expect(h.ours()).toBeNull();
    h.camera.userMoved();
    h.camera.dispatch({ type: "slowmo.follow", view: { x: 70, y: 50, zoom: 0.7 } });
    expect(h.moves.at(-1)?.target).not.toEqual({ x: 70, y: 50, zoom: 0.7 });
    // Back to live: the view from before, and the owner from before unless a pan by hand took it.
    h.camera.dispatch({ type: "slowmo", on: false, restore: { x: 0, y: 0, zoom: 1 } });
    expect(h.journal.at(-1)).toMatchObject({ command: "restore", to: { x: 0, y: 0, zoom: 1 } });
    expect(h.ownership.owner).toBe("manual");
  });

  it("a move by hand makes the view manual: later panel work reveals instead of refitting", () => {
    const h = harness();
    h.camera.userMoved();
    expect(h.ownership.owner).toBe("manual");
    h.env.covered = true;
    h.camera.dispatch({ type: "pane.changed", cause: "panel" });
    h.tick(2);
    expect(h.journal.map((e) => `${e.command}:${e.cause}`)).toEqual(["reveal:panel"]);
  });

  it("Shift+0 zooms about the centre and keeps the view manual", () => {
    const h = harness();
    h.view.current = { x: 0, y: 0, zoom: 0.5 };
    h.camera.dispatch({ type: "zoom100" });
    expect(h.moves[0].target.zoom).toBe(1);
    expect(h.ownership.owner).toBe("manual");
  });

  it("still decides while unmounted between StrictMode's two mounts, and resumes pane work on mount", () => {
    const h = harness();
    const unmount = h.camera.connect();
    unmount();
    h.camera.mode({ live: false, presenting: false });
    expect(h.journal.map((e) => `${e.command}:${e.cause}`)).toEqual(["fit:mode"]);
    h.camera.dispatch({ type: "pane.changed", cause: "panel" });
    h.tick(3);
    expect(h.journal.filter((e) => e.cause === "pane")).toHaveLength(0);
    h.camera.connect();
    h.tick(2);
    expect(h.journal.filter((e) => e.cause === "pane")).toHaveLength(1);
  });

  it("the command palette's go-to takes the view", () => {
    const h = harness();
    h.camera.goTo("a");
    expect(h.moves).toHaveLength(1);
    expect(h.ownership.owner).toBe("manual");
  });
});

// ---------------------------------------------------------------- interleavings (fast-check model run)

type Model = { pending: boolean; menu: boolean; fits: number; created: number; last: string | null };
type Real = ReturnType<typeof harness>;
const check = (m: Model, r: Real) => {
  const phase = r.camera.phase;
  if (m.pending) expect(phase).toBe(m.menu ? "deferred" : "pending");
  expect(r.env.panePending).toBe(m.pending && !m.menu);
  // The readiness signal tells the truth about our moves: animating while one is scheduled or running (none is
  // forgotten while it runs), never stuck on one that another writer stopped.
  if (phase === "idle") expect(r.ours()).toBeNull();
  if (phase === "animating") expect(r.ours()).not.toBeNull();
  // Pending work runs at most once per creation.
  expect(m.fits).toBeLessThanOrEqual(m.created);
  // Every reveal started from a landing point or a still view: never mid-move, never a target nothing moves to.
  expect(r.midMove()).toBe(0);
  expect(r.stale()).toBe(0);
};
type Cmd = fc.AsyncCommand<Model, Real>;
const command = (name: string, run: (m: Model, r: Real) => void | Promise<void>, when?: (m: Model) => boolean) =>
  ({
    check: (m: Readonly<Model>) => when?.(m as Model) ?? true,
    async run(m: Model, r: Real) {
      await run(m, r);
      check(m, r);
    },
    toString: () => name,
  }) satisfies Cmd;
const panel = command("panel", (m, r) => {
  r.camera.dispatch({ type: "pane.changed", cause: "panel" });
  m.pending = true;
  m.created++;
});
const menuOpen = command(
  "menu.open",
  (m, r) => {
    r.camera.dispatch({ type: "menu.opened", kind: "context" });
    m.menu = true;
    m.last = null;
  },
  (m) => !m.menu,
);
const menuClose = command(
  "menu.close",
  (m, r) => {
    r.camera.dispatch({ type: "menu.closed" });
    m.menu = false;
  },
  (m) => m.menu,
);
const frame = (sample: string | null) =>
  command(`frame(${sample})`, (m, r) => {
    const before = r.journal.length;
    r.env.sample = sample;
    r.tick();
    const ran = r.journal.slice(before).filter((e) => e.cause === "pane").length;
    // The model's own settle rule: armed work runs on the second of two agreeing, present samples.
    const armed = m.pending && !m.menu;
    const expected = armed && sample !== null && sample === m.last;
    expect(ran > 0).toBe(expected);
    m.last = armed && !expected ? sample : null;
    if (ran) {
      m.pending = false;
      m.fits++;
    }
  });
const fit = command("fit", (m, r) => {
  r.camera.dispatch({ type: "fit", reason: "command" });
  m.pending = false;
  m.last = null;
});
const refine = command("refine", (_m, r) => r.refine());
const finish = command("finish", (_m, r) => r.finish());
const input = command("input", (_m, r) => r.camera.input("other"));
const reveal = command("reveal", (_m, r) => {
  r.env.covered = true;
  r.camera.dispatch({ type: "reveal.requested", cause: "navigation" });
});
/** Live, slow motion, the minimap or the zoom buttons move the view: d3 stops ours (its promise never resolves). */
const foreignNow = command("foreign.now", (_m, r) => r.foreignNow());
const foreignAnimated = command("foreign.animated", (_m, r) => r.foreignAnimated());

describe("camera controller: interleavings", () => {
  it("keeps its invariants under any order of events, frames, landings and other writers (a slow machine)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.commands(
          [
            fc.constant(panel),
            fc.constant(menuOpen),
            fc.constant(menuClose),
            fc.constantFrom(frame("1000x800"), frame("900x800"), frame(null)),
            fc.constant(fit),
            fc.constant(refine),
            fc.constant(finish),
            fc.constant(input),
            fc.constant(reveal),
            fc.constant(foreignNow),
            fc.constant(foreignAnimated),
          ],
          { maxCommands: 40 },
        ),
        async (cmds) => {
          const model: Model = { pending: false, menu: false, fits: 0, created: 0, last: null };
          const real = harness();
          await fc.asyncModelRun(() => ({ model, real }), cmds);
          // Drains: whatever the interleaving left, closing the menu, releasing input and letting the pane settle
          // runs the outstanding work exactly once, and every move lands: the camera ends idle.
          const ran = model.fits;
          const start = real.journal.length;
          if (model.menu) real.camera.dispatch({ type: "menu.closed" });
          real.camera.input("release");
          real.env.sample = "1000x800";
          real.tick(3);
          const runs = real.journal.slice(start).filter((e) => e.command === "fit" && e.cause === "pane").length;
          for (let i = 0; i < 4; i++) {
            await real.refine();
            await real.finish();
            real.tick();
          }
          expect(real.camera.phase).toBe("idle");
          expect(real.env.panePending).toBe(false);
          expect(real.ours()).toBeNull();
          expect(runs).toBe(model.pending ? 1 : 0);
          expect(ran).toBeLessThanOrEqual(model.created);
        },
      ),
      { numRuns: 500 },
    );
  });
});
