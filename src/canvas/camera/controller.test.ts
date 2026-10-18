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
  const port: CameraPort = {
    viewport: () => view.current,
    move(target, o) {
      moves.push({ target, ...o });
      active?.resolve();
      if (o.duration <= 0) {
        active = null;
        view.current = target;
        return Promise.resolve(true);
      }
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
    // Its own fit starting is not an interruption.
    h.camera.moveStarted(false);
    expect(h.env.refine).not.toBeNull();
    // Before anything has run or been interrupted, a foreign start is React Flow's own opening fit.
    h.camera.moveStarted(false);
    expect(h.env.refine).not.toBeNull();
    await h.finish();
    h.camera.input("other");
    h.camera.dispatch({ type: "fit", reason: "command" });
    h.camera.moveStarted(false);
    expect(h.env.refine).not.toBeNull();
    // Once the fit has landed, a start without an event is someone else's (Live, slow motion): it stops the fit.
    await h.finish();
    h.camera.moveStarted(false);
    expect(h.env.refine).toBeNull();
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

  it("the command palette's go-to takes the view", () => {
    const h = harness();
    h.camera.goTo("a");
    expect(h.moves).toHaveLength(1);
    expect(h.ownership.owner).toBe("manual");
  });
});

// ---------------------------------------------------------------- interleavings (fast-check model run)

type Model = { pending: boolean; menu: boolean; fits: number; created: number };
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
    if (ran) {
      expect(m.pending && !m.menu).toBe(true);
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
          ],
          { maxCommands: 40 },
        ),
        async (cmds) => {
          await fc.asyncModelRun(
            () => ({ model: { pending: false, menu: false, fits: 0, created: 0 }, real: harness() }),
            cmds,
          );
        },
      ),
      { numRuns: 300 },
    );
  });
});
