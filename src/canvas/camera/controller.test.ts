import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createCameraOwnership } from "../cameraOwnership";
import type { Viewport } from "../geometry/fit";
import { createCameraController, type CameraPort, type JournalEntry, type RevealScope } from "./controller";
import type { CameraPhase } from "./types";

/**
 * A deterministic stand-in for React Flow and the frame clock. A move with a duration leaves the view at an
 * intermediate point until the test finishes it, so a reveal computed from the live view would be caught.
 */
function harness() {
  const frames: (() => void)[] = [];
  const view = { current: { x: 0, y: 0, zoom: 1 } as Viewport };
  let active: { target: Viewport; resolve: () => void } | null = null;
  const moves: { target: Viewport; duration: number; linear: boolean }[] = [];
  const revealBases: Viewport[] = [];
  /** Reveals computed from an intermediate frame of a move in flight. */
  let midMove = 0;
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
  };
  /** React Flow reports every move start to the canvas (onMoveStart without an event). */
  const started = { report: (_user: boolean) => {} };
  /** Our transitions issued but not yet started (d3 starts them on its next tick). */
  let starting = 0;
  const port: CameraPort = {
    viewport: () => view.current,
    move(target, o) {
      moves.push({ target, ...o });
      // As React Flow: a transition another move replaces (d3 interrupts it) never resolves its promise.
      if (o.duration <= 0) {
        active = null;
        view.current = target;
        started.report(false);
        return Promise.resolve(true);
      }
      starting++;
      frames.unshift(() => {
        starting--;
        started.report(false);
      });
      const from = view.current;
      // Mid-way: the zoom and position of an intermediate frame.
      view.current = { x: (from.x + target.x) / 2, y: (from.y + target.y) / 2, zoom: (from.zoom + target.zoom) / 2 };
      return new Promise<void>((resolve) => {
        active = {
          target,
          resolve: () => {
            resolve();
          },
        };
      });
    },
    fitTarget: () => ({ x: 5, y: 5, zoom: 0.8 }),
    revealTarget(base: Viewport, _scope: RevealScope) {
      revealBases.push(base);
      if (active && same(base, view.current) && !same(base, active.target)) midMove++;
      return env.covered ? { x: base.x - 40, y: base.y, zoom: base.zoom } : null;
    },
    centerTarget: () => null,
    goToTarget: (base) => ({ ...base, x: base.x + 100 }),
    zoomTarget: (base, zoom) => ({ ...base, zoom }),
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
  /** The transition in flight lands; the promise callbacks run. */
  const finish = async () => {
    if (active) {
      view.current = active.target;
      const a = active;
      active = null;
      a.resolve();
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
    active: () => active,
    starting: () => starting,
    /** Another writer's move: d3 interrupts ours, and React Flow never resolves its promise. */
    interruptActive: () => {
      active = null;
    },
    midMove: () => midMove,
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
    // Once the fit has landed, a start without an event is someone else's (Live, slow motion): it stops the fit.
    await h.finish();
    h.camera.moveStarted(false);
    expect(h.env.refine).toBeNull();
  });

  it("a foreign zoom that interrupts a pan leaves nothing in flight, and the next reveal starts from the real view", () => {
    const h = harness();
    h.env.covered = true;
    h.camera.dispatch({ type: "reveal.requested", cause: "placement" });
    h.tick();
    expect(h.camera.phase).toBe("animating");
    // The zoom buttons (React Flow's own zoomIn) replace the pan; its promise never resolves.
    h.camera.userMoved();
    h.view.current = { x: 3, y: 4, zoom: 1.5 };
    h.camera.moveStarted(false);
    expect(h.camera.phase).toBe("idle");
    h.camera.dispatch({ type: "input" });
    h.camera.dispatch({ type: "reveal.requested", cause: "navigation" });
    expect(h.revealBases.at(-1)).toEqual({ x: 3, y: 4, zoom: 1.5 });
    expect(h.moves.at(-1)?.target.zoom).toBe(1.5);
  });

  it("a Live or slow-motion move that interrupts a pan clears it too", () => {
    const h = harness();
    h.env.covered = true;
    h.camera.dispatch({ type: "reveal.requested", cause: "placement" });
    h.tick();
    expect(h.camera.phase).toBe("animating");
    h.view.current = { x: 9, y: 9, zoom: 0.7 };
    h.camera.moveStarted(false);
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
    // React Flow never reports its start: drop the queued start report.
    h.frames.shift();
    h.interruptActive();
    h.tick(2);
    expect(h.camera.phase).toBe("idle");
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
  // At most one move in flight, and the readiness signal tells the truth about it.
  const phase = r.camera.phase;
  if (m.pending) expect(phase).toBe(m.menu ? "deferred" : "pending");
  expect(r.env.panePending).toBe(m.pending && !m.menu);
  if (phase === "idle") expect(r.active()).toBeNull();
  // Pending work runs at most once per creation.
  expect(m.fits).toBeLessThanOrEqual(m.created);
  // Every reveal started from a landing point or a still view, never mid-move.
  expect(r.midMove()).toBe(0);
};
class Panel implements fc.AsyncCommand<Model, Real> {
  check = () => true;
  async run(m: Model, r: Real) {
    r.camera.dispatch({ type: "pane.changed", cause: "panel" });
    m.pending = true;
    m.created++;
    check(m, r);
  }
  toString = () => "panel";
}
class MenuOpen implements fc.AsyncCommand<Model, Real> {
  check = (m: Readonly<Model>) => !m.menu;
  async run(m: Model, r: Real) {
    r.camera.dispatch({ type: "menu.opened", kind: "context" });
    m.menu = true;
    m.last = null;
    check(m, r);
  }
  toString = () => "menu.open";
}
class MenuClose implements fc.AsyncCommand<Model, Real> {
  check = (m: Readonly<Model>) => m.menu;
  async run(m: Model, r: Real) {
    r.camera.dispatch({ type: "menu.closed" });
    m.menu = false;
    check(m, r);
  }
  toString = () => "menu.close";
}
class Frame implements fc.AsyncCommand<Model, Real> {
  constructor(readonly sample: string | null) {}
  check = () => true;
  async run(m: Model, r: Real) {
    const before = r.journal.length;
    r.env.sample = this.sample;
    r.tick();
    const ran = r.journal.slice(before).filter((e) => e.command === "fit" || e.command === "reveal").length;
    // The model's own settle rule: armed work runs on the second of two agreeing, present samples.
    const armed = m.pending && !m.menu;
    const expected = armed && this.sample !== null && this.sample === m.last;
    expect(ran > 0).toBe(expected);
    m.last = armed && !expected ? this.sample : null;
    if (ran) {
      m.pending = false;
      m.fits++;
    }
    check(m, r);
  }
  toString = () => `frame(${this.sample})`;
}
class Finish implements fc.AsyncCommand<Model, Real> {
  check = () => true;
  async run(m: Model, r: Real) {
    await r.finish();
    check(m, r);
  }
  toString = () => "finish";
}
class Input implements fc.AsyncCommand<Model, Real> {
  check = () => true;
  async run(m: Model, r: Real) {
    r.camera.input("other");
    check(m, r);
  }
  toString = () => "input";
}
/** Live, slow motion or the zoom buttons move the view: d3 replaces our transition, whose promise never resolves. */
class Foreign implements fc.AsyncCommand<Model, Real> {
  // Generated after our transitions have started: one pre-empted before its first tick is a known gap
  // (docs/backlog/2026-10-17-camera-review-followups.md).
  check = () => true;
  async run(m: Model, r: Real) {
    if (r.starting()) return check(m, r);
    r.interruptActive();
    r.view.current = { x: r.view.current.x + 7, y: r.view.current.y, zoom: r.view.current.zoom };
    r.camera.moveStarted(false);
    check(m, r);
  }
  toString = () => "foreign";
}
class Reveal implements fc.AsyncCommand<Model, Real> {
  check = () => true;
  async run(m: Model, r: Real) {
    r.env.covered = true;
    r.camera.dispatch({ type: "reveal.requested", cause: "navigation" });
    check(m, r);
  }
  toString = () => "reveal";
}

describe("camera controller: interleavings", () => {
  it("keeps its invariants under any order of events, frames and landings (a slow machine)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.commands(
          [
            fc.constant(new Panel()),
            fc.constant(new MenuOpen()),
            fc.constant(new MenuClose()),
            fc.constantFrom(new Frame("1000x800"), new Frame("900x800"), new Frame(null)),
            fc.constant(new Finish()),
            fc.constant(new Input()),
            fc.constant(new Reveal()),
            fc.constant(new Foreign()),
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
          expect(runs).toBe(model.pending ? 1 : 0);
          expect(ran).toBeLessThanOrEqual(model.created);
        },
      ),
      { numRuns: 300 },
    );
  });
});
