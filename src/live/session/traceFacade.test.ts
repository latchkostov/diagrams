import { describe, expect, it, vi } from "vitest";
import { machinePaths, machineStep } from "../../lib/machine";
import { lazySurfacesFixture } from "../../lab/lazySurfacesFixture";
import { LiveController } from "../controller";
import { SlowMotion } from "../slowmo/session";
import { buildScript, frameAt, stepStop } from "../slowmo/script";
import { createTraceFacade } from "./traceFacade";
import { traceRuntimeMachine } from "./traceRuntimeMachine";

describe("trace runtime handoff", () => {
  it.each([false, true])(
    "preserves the requested checkpoint and play=%s through one failure and modal handoff",
    (playing) => {
      const diagram = lazySurfacesFixture();
      const c = new LiveController(diagram);
      c.setTraffic(true);
      c.setPlaying(playing);
      const checkpoint = c.getState().snapshot;
      let blocked = true;
      const before = { x: 12, y: 34, zoom: 0.8 };
      const facade = createTraceFacade(
        c,
        () => before,
        () => blocked,
      );
      facade.slow.start({ kind: "next", node: "caller" });
      expect(c.isHeld).toBe(true);
      expect(c.isPlaying).toBe(false);
      c.advance(2000);
      c.togglePlaying();
      c.step();
      expect(c.getState().snapshot).toEqual(checkpoint);
      facade.fail();
      expect(facade.phase).toBe("failed");
      const session = new SlowMotion(c, {
        code: { buildScript, frameAt, stepStop },
        build: (trace) => buildScript({ trace, diagram, roleOf: () => "processor" }),
        schedule: (work) => {
          work();
          return () => {};
        },
      });
      const start = vi.fn((source) => session.start(source));
      facade.attach({
        slow: {
          session,
          state: session.getState(),
          path: null,
          start,
          end: () => session.end(),
          frame: () => undefined,
          ui: () => {},
        },
        journey: () => ({ nodes: new Set(), edges: new Set() }),
      });
      expect(start).not.toHaveBeenCalled();
      blocked = false;
      facade.slow.frame(0, 1);
      expect(start).toHaveBeenCalledExactlyOnceWith({ kind: "next", node: "caller" }, before);
      expect(c.getState().snapshot.time).toBe(checkpoint.time);
      facade.slow.end();
      expect(c.isHeld).toBe(false);
      expect(c.isPlaying).toBe(playing);
      c.dispose();
    },
  );

  it.each(["cancel", "dispose"] as const)("%s retires a failed/replaced request before late readiness", (type) => {
    const c = new LiveController(lazySurfacesFixture());
    c.setPlaying(true);
    const facade = createTraceFacade(
      c,
      () => ({ x: 0, y: 0, zoom: 1 }),
      () => false,
    );
    facade.slow.start({ kind: "next", node: "caller" });
    facade.slow.start({ kind: "root", rootId: 42 });
    facade.fail();
    if (type === "cancel") facade.slow.end();
    else facade.dispose();
    facade.slow.frame(16, 1);
    expect(facade.pending).toBe(false);
    expect(c.isHeld).toBe(false);
    expect(c.isPlaying).toBe(true);
    c.dispose();
  });

  it("explores accepted machine paths, including cancellation followed by stale readiness", () => {
    const paths = machinePaths(traceRuntimeMachine, { maxDepth: 4 });
    expect(paths.some(({ state }) => state.value === "failed")).toBe(true);
    for (const { state } of paths) {
      if (state.value === "waiting" || state.value === "failed") expect(state.source).not.toBeNull();
      else expect(state.source).toBeNull();
      if (state.value === "idle" || state.value === "disposed")
        expect(machineStep(traceRuntimeMachine, state, { type: "ready" }).commands).toEqual([]);
    }
  });
});
