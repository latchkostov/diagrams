import { expect, it, vi } from "vitest";
import type { DiagramFile, Simulation } from "../model/types";
import { LiveController } from "./controller";
import { TroubleTracker } from "./useObservedTrouble";

const diagram: DiagramFile = {
  format: "diagrams/v1",
  title: "Orders",
  nodes: [
    { id: "web", stencil: "client.browser", label: "Web", x: 0, y: 0 },
    { id: "q", stencil: "aws.sqs", label: "orders", x: 0, y: 0 },
    { id: "worker", stencil: "service.go", label: "Worker", x: 0, y: 0 },
  ],
  edges: [
    { id: "a", from: "web", to: "q" },
    { id: "b", from: "q", to: "worker" },
  ],
};

it("an observed outage hidden behind Inputs keeps its turn; a shown outage ends", () => {
  const controller = new LiveController(diagram);
  const tracker = new TroubleTracker(controller);
  const off = tracker.subscribe(() => undefined);
  controller.setNodeStatus("worker", "down");
  expect(tracker.current()?.key).toBe("down:worker");
  controller.setNodeStatus("worker", "up");
  expect(tracker.current()).toBeUndefined();
  controller.setNodeStatus("worker", "down");
  expect(tracker.current()?.key).toBe("down:worker");
  tracker.shown("down:worker");
  controller.setNodeStatus("worker", "up");
  controller.setNodeStatus("worker", "down");
  expect(tracker.current()).toBeUndefined();
  off();
});

it("reading an external-store snapshot does not observe or mutate display history", () => {
  const controller = new LiveController(diagram);
  const tracker = new TroubleTracker(controller);
  const read = vi.spyOn(controller, "getState");
  for (let i = 0; i < 10; i++) expect(tracker.current()).toBeUndefined();
  expect(read).not.toHaveBeenCalled();
});

it("an ongoing lag warning returns after forward seeking warms its history", () => {
  const sim: Simulation = {
    id: "lag",
    title: "Lag",
    traffic: [
      {
        id: "traffic",
        node: "web",
        messageType: "Order",
        shape: { kind: "constant", ratePerSec: 100, durationMs: 60_000 },
      },
    ],
    timeline: [],
  };
  const controller = new LiveController(diagram);
  controller.selectSimulation(sim);
  const tracker = new TroubleTracker(controller);
  const off = tracker.subscribe(() => undefined);
  for (let i = 0; i < 12; i++) controller.step(1000);
  expect(tracker.current()?.key).toBe("lag:q");
  tracker.shown("lag:q");
  const generation = controller.getState().generation;
  controller.seek(20_000);
  expect(controller.getState().generation).toBe(generation);
  expect(tracker.current()).toBeUndefined();
  for (let i = 0; i < 10; i++) controller.step(1000);
  expect(tracker.current()?.key).toBe("lag:q");
  off();
});
