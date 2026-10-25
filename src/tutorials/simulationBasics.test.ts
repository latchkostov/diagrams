import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import { LiveController } from "../live/controller";
import { holds, resolveSubjects, type SandboxView } from "./checks";
import { capacity } from "./catalog/capacity";
import { ratesAndInputs } from "./catalog/ratesAndInputs";

describe("simulation basics lesson readings", () => {
  it("offers the View menu used by the capacity overlay solution", () => {
    expect(capacity.chrome).toBe("app");
    const overlay = capacity.steps.find((s) => s.id === "overlay")!;
    expect(overlay.solution).toEqual([{ click: "view-button" }, { click: "capacity-overlay-toggle" }]);
    expect(overlay.targets).toContainEqual(expect.objectContaining({ testId: "view-button" }));
  });

  it("Traffic × 3 triples the lesson’s request rate", () => {
    const playback = (traffic: number) => {
      if (typeof ratesAndInputs.start !== "function") throw new Error("Expected an inline practice diagram");
      const diagram = ratesAndInputs.start();
      const subjects = resolveSubjects(ratesAndInputs, diagram);
      const client = diagram.nodes.find((n) => n.id === subjects.client)!;
      client.props = { ...client.props, ratePerSec: 6 };
      const controller = new LiveController(diagram);
      try {
        // Follow the lesson's authored traffic path, including any Continuous traffic toggle.
        for (const action of ratesAndInputs.steps.find((s) => s.id === "live")!.demo) {
          if (action.kind === "runSimulation")
            controller.selectSimulation(diagram.simulations!.find((s) => s.id === action.id)!);
          else if (action.kind === "traffic") controller.setTraffic(action.on);
          else throw new Error("Expected a simulation or traffic action");
        }
        controller.setInputs({ ...controller.getState().inputs, traffic });
        controller.setPlaying(true);
        for (let frame = 0; frame < 30; frame++) controller.advance(100);
        controller.publish();
        const processed = (id: string) => controller.getState().snapshot.nodes[id]?.processed ?? 0;
        const view: SandboxView = { diagram, live: true, session: controller.getState(), processed };
        expect(client.props.ratePerSec).toBe(6);
        return {
          processed: processed(subjects.service!),
          complete: holds(ratesAndInputs.steps.find((s) => s.id === "watch")!.check, view, subjects),
        };
      } finally {
        controller.dispose();
      }
    };
    const baseline = playback(1);
    const tripled = playback(3);
    expect(baseline.processed).toBeGreaterThan(0);
    expect(tripled.processed / baseline.processed).toBeGreaterThanOrEqual(3 * (1 - 1 / 8));
    expect(tripled.processed / baseline.processed).toBeLessThanOrEqual(3 * (1 + 1 / 8));
    expect(baseline.complete).toBe(false);
    expect(tripled.complete).toBe(true);
  });

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
