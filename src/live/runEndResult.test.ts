import { expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import zone from "../examples/zone-outage-drill.json";
import serverless from "../examples/aws-serverless-orders.json";
import { LiveController } from "./controller";
import { runEndResult } from "./runEndResult";

it("names the largest real loss and does not celebrate a failed zero-loss goal", () => {
  const diagram = zone as DiagramFile;
  const controller = new LiveController(diagram);
  try {
    for (const simulation of diagram.simulations!) {
      controller.selectSimulation(simulation);
      expect(runEndResult(controller.getState(), diagram)).toBeUndefined();
      controller.seek(9000);
      expect(runEndResult(controller.getState(), diagram)).toBe(
        simulation.id === "health-checks" ? "No messages lost" : "Lost 26 messages at Checkout API b",
      );
    }
    const state = controller.getState();
    const nodes = structuredClone(state.snapshot.nodes);
    nodes["api-a"].dropped = 40;
    expect(runEndResult({ ...state, snapshot: { ...state.snapshot, nodes } }, diagram)).toBe(
      "Lost 40 messages at Checkout API a",
    );
    for (const node of Object.values(nodes)) {
      node.dropped = 0;
      node.deadLettered = 0;
    }
    expect(runEndResult({ ...state, snapshot: { ...state.snapshot, nodes } }, diagram)).toBe(
      "No messages lost; other expectations failed",
    );
    const unnamed = { ...diagram, nodes: diagram.nodes.map((node) => ({ ...node, label: "" })) };
    expect(runEndResult(state, unnamed)).toBe("Lost 26 messages at the system");
  } finally {
    controller.dispose();
  }
});

it("does not report recovered dead letters as lost in the 3PL outage and DLQ redrive run", () => {
  const diagram = serverless as DiagramFile;
  const controller = new LiveController(diagram);
  try {
    controller.selectSimulation(diagram.simulations!.find((s) => s.id === "three-pl-outage")!);
    controller.seek(60000);
    const state = controller.getState();
    expect(state.run?.done).toBe(true);
    expect(state.run?.expectations.every((e) => e.status === "pass")).toBe(true);
    const nodes = Object.values(state.snapshot.nodes);
    expect(nodes.reduce((n, node) => n + node.deadLettered, 0)).toBeGreaterThan(0);
    expect(nodes.reduce((n, node) => n + node.dropped, 0)).toBe(0);
    expect(state.snapshot.nodes.dlq.backlog).toBe(0);
    expect(runEndResult(state, diagram)).toBe("No messages lost");
  } finally {
    controller.dispose();
  }
});
