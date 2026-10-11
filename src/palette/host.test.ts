import { describe, expect, it, vi } from "vitest";
import { placeNextTo } from "./canvasHost";
import { paletteHost, publish } from "./host";

const box = (x: number, y: number, width = 100, height = 50) => ({ x, y, width, height });

describe("placeNextTo", () => {
  it("goes one gap to the right (LR), vertically centred on the source", () => {
    const at = placeNextTo(box(0, 0), { width: 100, height: 50 }, [box(0, 0)]);
    expect(at.x).toBeGreaterThan(100 + 50); // centre beyond the source's right edge
    expect(at.y).toBe(25);
  });

  it("steps down past nodes already there", () => {
    const blocker = box(180, 0);
    const at = placeNextTo(box(0, 0), { width: 100, height: 50 }, [box(0, 0), blocker]);
    expect(at.y - 25).toBeGreaterThanOrEqual(50);
  });

  it("goes below for top-to-bottom diagrams", () => {
    const at = placeNextTo(box(0, 0), { width: 100, height: 50 }, [box(0, 0)], "TB");
    expect(at.x).toBe(50);
    expect(at.y).toBeGreaterThan(50);
  });
});

describe("paletteHost", () => {
  it("does not switch simulations while the live session is guarded", () => {
    paletteHost.reset();
    const run = vi.fn();
    const off = publish("session", { run, disabledHint: "Exit slow motion (Esc) first" });
    expect(paletteHost.runSimulation("peak")).toBe(false);
    expect(run).not.toHaveBeenCalled();
    off();
  });
  it("can't run a simulation without a live view", () => {
    paletteHost.reset();
    expect(paletteHost.runSimulation("peak")).toBe(false);
    expect(paletteHost.get().pendingRun).toBeNull();
  });
});
