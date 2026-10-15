import { describe, expect, it } from "vitest";
import example from "../examples/autoscaling-image-workers.json";
import type { DiagramFile } from "../model/types";
import { LiveController } from "../live/controller";

const diagram = example as DiagramFile;
describe("public autoscaling showcase", () => {
  it("starts replicas behind Kafka and drains the saved burst within ten simulated seconds", () => {
    const controller = new LiveController(diagram);
    controller.selectSimulation(diagram.simulations![0]);
    controller.setPlaying(true);
    const advance = (ticks: number) => {
      for (let i = 0; i < ticks; i++) controller.advance(10);
      controller.publish();
      return controller.snapshot();
    };
    try {
      const starting = advance(200);
      expect(starting.nodes.worker.fleet).toMatchObject({ ready: 1, starting: 1, desired: 2 });
      expect(starting.nodes.uploads.lag.thumbnails).toBeGreaterThan(0);
      const ready = advance(400);
      expect(ready.nodes.worker.fleet!.ready).toBeGreaterThan(1);
      const drained = advance(400);
      expect(drained.nodes.worker.processed).toBe(192);
      expect(drained.nodes.uploads.lag.thumbnails).toBe(0);
      expect(drained.nodes.worker.backlog).toBe(0);
      expect(drained.nodes.worker.fleet!.history.some((p) => p.starting > 0)).toBe(true);
      expect(drained.nodes.worker.fleet!.history.some((p) => p.ready > 1)).toBe(true);
    } finally {
      controller.dispose();
    }
  });
});
