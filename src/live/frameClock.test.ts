import { describe, expect, it } from "vitest";
import { DIAGRAM_FORMAT, type DiagramFile, type SimRole } from "../model/types";
import { LiveController } from "./controller";
import { CATCH_UP_MS, createFrameClock, FRAME_STEP_MS } from "./frameClock";

const roles: Record<string, SimRole> = { src: "source", q: "queue", svc: "processor" };
const diagram = (): DiagramFile => ({
  format: DIAGRAM_FORMAT,
  title: "t",
  nodes: [
    { id: "api", stencil: "src", label: "api", x: 0, y: 0 },
    { id: "queue", stencil: "q", label: "queue", x: 0, y: 0 },
    { id: "worker", stencil: "svc", label: "worker", x: 0, y: 0 },
  ],
  edges: [
    { id: "e1", from: "api", to: "queue" },
    { id: "e2", from: "queue", to: "worker" },
  ],
});

/** A playing controller driven by a fake animation-frame clock, as LiveSession's tick drives it. */
function rig() {
  const c = new LiveController(diagram(), { roleOf: (s) => roles[s] ?? "none" });
  c.setTraffic(true);
  c.setPlaying(true);
  let now = 1_000;
  const clock = createFrameClock(now);
  const frame = (ms: number) => {
    now += ms;
    const step = clock.step(now);
    c.advance(step.sim);
    return step;
  };
  return { c, clock, frame, time: () => c.snapshot().time };
}

describe("live frame clock", () => {
  it("moves the simulation by a normal frame exactly", () => {
    const { frame, time } = rig();
    for (let i = 0; i < 60; i++) frame(16);
    expect(time()).toBe(960);
  });

  it("catches up a 3 s frame up to CATCH_UP_MS; slow motion and the march keep the 100 ms step", () => {
    const { frame, time } = rig();
    frame(20);
    const before = time();
    const step = frame(3_000);
    expect(step).toEqual({ sim: CATCH_UP_MS, visual: FRAME_STEP_MS });
    expect(time() - before).toBe(CATCH_UP_MS);
    // A frame under the cap moves it by its own length.
    const mid = time();
    frame(400);
    expect(time() - mid).toBe(400);
  });

  it("doesn't jump after the page was hidden, however long it was away", () => {
    const { clock, frame, time } = rig();
    frame(20);
    const before = time();
    clock.hidden();
    expect(frame(5 * 60_000)).toEqual({ sim: 0, visual: 0 });
    expect(time()).toBe(before);
    // Then it runs on as usual.
    frame(20);
    expect(time() - before).toBe(20);
  });

  it("is deterministic: one catch-up step replays the same ticks as many small frames", () => {
    const a = rig();
    const b = rig();
    for (let i = 0; i < 10; i++) a.frame(100);
    b.frame(1_000);
    expect(b.time()).toBe(a.time());
    expect(b.c.snapshot().nodes).toEqual(a.c.snapshot().nodes);
  });

  it("never steps backwards on a clock that went back", () => {
    const clock = createFrameClock(500);
    expect(clock.step(400)).toEqual({ sim: 0, visual: 0 });
  });
});
