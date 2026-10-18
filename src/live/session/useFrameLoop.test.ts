import { afterEach, describe, expect, it, vi } from "vitest";
import { DIAGRAM_FORMAT } from "../../model/types";
import { LiveController } from "../controller";
import { CATCH_UP_MS, createFrameClock } from "../frameClock";
import { advanceFrame } from "./useFrameLoop";

const fixtureText = "Frame cost";

function controller() {
  const c = new LiveController({ format: DIAGRAM_FORMAT, title: fixtureText, nodes: [], edges: [] });
  c.setPlaying(true);
  return c;
}

afterEach(() => vi.restoreAllMocks());

describe("frame loop engine cost", () => {
  it("measures an advance that moves simulated time", () => {
    const c = controller();
    const clock = createFrameClock(0);
    const spent = vi.spyOn(clock, "spent");
    vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValueOnce(90);

    advanceFrame(c, clock, 100);

    expect(c.snapshot().time).toBe(100);
    expect(spent).toHaveBeenCalledExactlyOnceWith(100, 90);
    const baseline = createFrameClock(0);
    baseline.spent(100, 90);
    expect(clock.step(600).sim).toBe(baseline.step(600).sim);
    expect(clock.step(1_200).sim).toBeLessThan(CATCH_UP_MS);
    c.dispose();
  });

  it.each(["paused", "held", "waiting", "finished", "zero step"] as const)(
    "retains the measured cost across %s frames",
    (idle) => {
      const c = controller();
      const clock = createFrameClock(0);
      const spent = vi.spyOn(clock, "spent");
      const now = vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValueOnce(90);
      advanceFrame(c, clock, 100);
      expect(spent).toHaveBeenCalledExactlyOnceWith(100, 90);
      spent.mockClear();
      now.mockReset().mockReturnValue(0);

      if (idle === "paused") c.setPlaying(false);
      else if (idle === "held") c.hold(true);
      else if (idle === "waiting" || idle === "finished") {
        c.selectSimulation({
          id: "idle",
          title: fixtureText,
          durationMs: idle === "finished" ? 100 : 1_000,
          traffic: [],
          timeline: idle === "waiting" ? [{ atMs: 100, action: { do: "note", text: fixtureText, pause: true } }] : [],
        });
        c.setPlaying(true);
        c.advance(100);
        c.publish();
        if (idle === "waiting") {
          expect(c.isPlaying).toBe(true);
          expect(c.getState().run?.waiting).toBe(true);
        } else expect(c.getState().run?.done).toBe(true);
      }

      const before = c.snapshot().time;
      for (let i = 0; i < 8; i++) advanceFrame(c, clock, idle === "zero step" ? 0 : 100);

      expect(c.snapshot().time).toBe(before);
      expect(spent).not.toHaveBeenCalled();
      const baseline = createFrameClock(0);
      baseline.spent(100, 90);
      expect(clock.step(600).sim).toBe(baseline.step(600).sim);
      c.dispose();
    },
  );
});
