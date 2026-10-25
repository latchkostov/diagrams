import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import { LiveController } from "../live/controller";
import { holds, resolveSubjects, type SandboxView } from "./checks";
import { capacity } from "./catalog/capacity";
import { ratesAndInputs } from "./catalog/ratesAndInputs";

describe("simulation basics lesson readings", () => {
  it("does not latch an initially empty queue as recovery before Apply fix", () => {
    const diagram = JSON.parse(readFileSync("src/examples/measured-order-capacity.json", "utf8")) as DiagramFile;
    const controller = new LiveController(diagram);
    try {
      controller.selectSimulation(diagram.simulations!.find((s) => s.id === "triple")!);
      const view = (): SandboxView => ({
        diagram,
        live: true,
        session: controller.getState(),
        processed: () => 0,
      });
      const subjects = resolveSubjects(capacity, diagram);
      const drain = capacity.steps.find((s) => s.id === "drain")!.check;
      expect(controller.getState().snapshot.nodes[subjects.queue!].backlog).toBe(0);
      expect(holds(drain, view(), subjects)).toBe(false);
      controller.setNodeProps(subjects.worker!, { replicas: 3 });
      controller.publish();
      expect(holds(drain, view(), subjects)).toBe(true);
    } finally {
      controller.dispose();
    }
  });

  it("shows at least thirty completions within ten simulated seconds at Rate 6 and Traffic × 3", () => {
    if (typeof ratesAndInputs.start !== "function") throw new Error("Expected an inline practice diagram");
    const diagram = ratesAndInputs.start();
    const subjects = resolveSubjects(ratesAndInputs, diagram);
    const client = diagram.nodes.find((n) => n.id === subjects.client)!;
    client.props = { ...client.props, ratePerSec: 6 };
    const controller = new LiveController(diagram);
    try {
      controller.selectSimulation(diagram.simulations![0]);
      controller.setInputs({ ...controller.getState().inputs, traffic: 3 });
      controller.setTraffic(true);
      controller.setPlaying(true);
      for (let frame = 0; frame < 100; frame++) controller.advance(100);
      controller.publish();
      const view: SandboxView = {
        diagram,
        live: true,
        session: controller.getState(),
        processed: (id) => controller.getState().snapshot.nodes[id]?.processed ?? 0,
      };
      expect(holds(ratesAndInputs.steps.find((s) => s.id === "watch")!.check, view, subjects)).toBe(true);
      expect(client.props.ratePerSec).toBe(6);
    } finally {
      controller.dispose();
    }
  });
});
