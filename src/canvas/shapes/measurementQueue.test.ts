import { describe, expect, it, vi } from "vitest";
import { createMeasurementQueue, queueShapeMeasurement } from "./measurementQueue";

describe("canvas handle measurement queue", () => {
  it.each([1, 100, 1000])("batches %i outline invalidations into one measurement per frame", (count) => {
    const frames: FrameRequestCallback[] = [];
    const schedule = vi.fn((callback: FrameRequestCallback) => frames.push(callback));
    const updateInternals = vi.fn();
    const queue = createMeasurementQueue(updateInternals, schedule);
    for (let i = 0; i < count; i++) {
      queue(`shape-${i}`);
      queue(`shape-${i}`);
    }
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(updateInternals).not.toHaveBeenCalled();
    frames.shift()!(0);
    expect(updateInternals).toHaveBeenCalledTimes(1);
    expect(updateInternals.mock.calls[0][0]).toEqual(Array.from({ length: count }, (_, i) => `shape-${i}`));
    queue("pasted-shape");
    expect(schedule).toHaveBeenCalledTimes(2);
    frames.shift()!(1);
    expect(updateInternals).toHaveBeenCalledTimes(2);
  });
  it("shares a queue across shapes in a canvas and isolates other canvases", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    try {
      const store = {},
        otherStore = {};
      const update = vi.fn(),
        otherUpdate = vi.fn();
      for (let i = 0; i < 100; i++) queueShapeMeasurement(store, update, `shape-${i}`);
      queueShapeMeasurement(otherStore, otherUpdate, "other");
      expect(frames).toHaveLength(2);
      frames.forEach((frame) => frame(0));
      expect(update).toHaveBeenCalledTimes(1);
      expect(otherUpdate).toHaveBeenCalledExactlyOnceWith(["other"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
