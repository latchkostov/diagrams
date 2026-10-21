import { describe, expect, it, vi } from "vitest";
import { queueShapeMeasurement, whenShapeMeasurementsReady } from "./measurementQueue";

describe("canvas handle measurement queue", () => {
  it("readiness waits for every canvas's pending measurement batch", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    const update = vi.fn();
    let ready = false;
    try {
      for (let i = 0; i < 2; i++)
        queueShapeMeasurement({ getState: () => ({ updateNodeInternals: update }) }, "shape", {} as HTMLDivElement);
      const done = whenShapeMeasurementsReady().then(() => {
        ready = true;
      });
      await Promise.resolve();
      expect(ready).toBe(false);
      frames.shift()!(0);
      await Promise.resolve();
      expect(ready).toBe(false);
      frames.shift()!(1);
      await done;
      expect(update).toHaveBeenCalledTimes(2);
      expect(ready).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it.each([1, 100, 1000])("batches %i outline invalidations into one measurement per canvas frame", (count) => {
    const frames: FrameRequestCallback[] = [];
    const schedule = vi.fn((callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal("requestAnimationFrame", schedule);
    const update = vi.fn(),
      otherUpdate = vi.fn();
    const store = { getState: () => ({ updateNodeInternals: update }) };
    const otherStore = { getState: () => ({ updateNodeInternals: otherUpdate }) };
    const element = {} as HTMLDivElement;
    try {
      for (let i = 0; i < count; i++) {
        queueShapeMeasurement(store, `shape-${i}`, element);
        queueShapeMeasurement(store, `shape-${i}`, element);
      }
      expect(schedule).toHaveBeenCalledTimes(1);
      expect(update).not.toHaveBeenCalled();
      queueShapeMeasurement(otherStore, "other", element);
      expect(schedule).toHaveBeenCalledTimes(2);
      frames.splice(0).forEach((frame) => frame(0));
      expect(update).toHaveBeenCalledExactlyOnceWith(
        new Map(
          Array.from({ length: count }, (_, i) => [
            `shape-${i}`,
            { id: `shape-${i}`, nodeElement: element, force: true },
          ]),
        ),
      );
      expect(otherUpdate).toHaveBeenCalledExactlyOnceWith(
        new Map([["other", { id: "other", nodeElement: element, force: true }]]),
      );
      queueShapeMeasurement(store, "pasted-shape", element);
      expect(schedule).toHaveBeenCalledTimes(3);
      frames.shift()!(1);
      expect(update).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
