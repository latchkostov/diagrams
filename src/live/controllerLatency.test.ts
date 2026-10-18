import { expect, it } from "vitest";
import { LiveController } from "./controller";
import type { DiagramFile } from "../model/types";
import example from "../examples/where-the-time-goes.json";

it("publishes the same sampled latency through the Live controller", () => {
  const d = example as DiagramFile;
  const controller = new LiveController(d);
  controller.selectSimulation(d.simulations![0]);
  controller.setPlaying(true);
  controller.advance(3290);
  controller.publish();
  expect(controller.getState().snapshot.nodes.receipts.latency!.p95).toBe(300);
  controller.dispose();
});
