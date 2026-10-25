import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LiveController } from "../live/controller";
import type { DiagramFile } from "../model/types";
import { tutorials } from "./catalog";
import { capacity } from "./catalog/capacity";
import { traceSlowmo } from "./catalog/traceSlowmo";
import { savedSimulations } from "./catalog/savedSimulations";
import { scaleToZero } from "./catalog/scaleToZero";
import { loadShedding } from "./catalog/loadShedding";
import { deadLetters } from "./catalog/deadLetters";
import { holds, resolveSubjects, type SandboxView } from "./checks";
import { patchProps } from "./paths";
import type { Tutorial } from "./types";

const released = [capacity, traceSlowmo, savedSimulations, scaleToZero, loadShedding, deadLetters];
const start = (lesson: Tutorial): DiagramFile =>
  typeof lesson.start === "function"
    ? lesson.start()
    : (JSON.parse(readFileSync(`src/examples/${lesson.start.example}.json`, "utf8")) as DiagramFile);
const play = (controller: LiveController, frames: number) => {
  for (let frame = 0; frame < frames; frame++) controller.advance(100);
  controller.publish();
};

describe("2026-10-25 tutorial owner decisions", () => {
  for (const lesson of released)
    it(`${lesson.id}: is available to learners`, () => {
      expect(lesson.quarantined).toBeUndefined();
      expect(tutorials).toContain(lesson);
    });

  it("capacity keeps its View control and folds the automatic callout into Apply fix", () => {
    expect(capacity.chrome).toBe("app");
    expect(capacity.steps.map((step) => step.id)).toEqual(["live", "overlay", "backlog", "fix", "drain"]);
    expect(capacity.steps.find((step) => step.id === "fix")!.goal()).toContain("automatically");
    expect(capacity.steps.find((step) => step.id === "overlay")!.solution).toContainEqual({ click: "view-button" });
  });

  it("slow motion ends with the completed journey", () => {
    expect(traceSlowmo.steps.at(-1)!.check).toEqual({ kind: "slowmo", finished: true });
    expect(traceSlowmo.steps.flatMap((step) => step.solution)).not.toContainEqual({ click: "trace-sequence" });
  });

  it("the authored saved run pauses until Continue and then evaluates its expectation", () => {
    const diagram = start(savedSimulations);
    const controller = new LiveController(diagram);
    try {
      const selection = controller.selectSimulation(diagram.simulations![0]);
      expect(selection, controller.getState().resourceError).toBe("selected");
      controller.setPlaying(true);
      play(controller, 20);
      const paused = controller.getState();
      expect(paused.run!.waiting).toBeTruthy();
      expect(paused.run!.time).toBe(1200);
      play(controller, 20);
      expect(controller.getState().run!.time).toBe(paused.run!.time);
      controller.resume();
      play(controller, 60);
      const session = controller.getState();
      expect(session.run!.waiting).toBeFalsy();
      expect(session.run!.time).toBeGreaterThan(paused.run!.time);
      expect(
        holds(
          savedSimulations.steps.at(-1)!.check,
          { diagram, live: true, session, processed: () => 0 },
          resolveSubjects(savedSimulations, diagram),
        ),
      ).toBe(true);
    } finally {
      controller.dispose();
    }
  });

  it("cold start requires an instance starting in the morning rush and its readout", () => {
    const diagram = start(scaleToZero);
    const controller = new LiveController(diagram);
    try {
      const subjects = resolveSubjects(scaleToZero, diagram);
      const step = scaleToZero.steps.find((step) => step.id === "cold-start")!;
      expect(step).toBeDefined();
      controller.selectSimulation(diagram.simulations!.find((sim) => sim.id === "morning-rush")!);
      controller.setPlaying(true);
      const view = (): SandboxView => ({
        diagram,
        live: true,
        session: controller.getState(),
        processed: () => 0,
        readout: { kind: "node", id: subjects.worker! },
      });
      expect(holds(step.check, view(), subjects)).toBe(false);
      let seen = false;
      for (let frame = 0; frame < 100; frame++) {
        play(controller, 1);
        if (holds(step.check, view(), subjects)) {
          seen = true;
          expect(controller.getState().snapshot.nodes[subjects.worker!].fleet!.starting).toBeGreaterThanOrEqual(1);
          expect(holds(step.check, { ...view(), readout: null }, subjects)).toBe(false);
        }
      }
      expect(seen).toBe(true);
    } finally {
      controller.dispose();
    }
  });

  it("Inject 100 queues unbounded work, while the explicit queue limit sheds the repeated spike", () => {
    const diagram = start(loadShedding);
    const subjects = resolveSubjects(loadShedding, diagram);
    const controller = new LiveController(diagram);
    try {
      const simulation = diagram.simulations![0];
      expect(simulation.traffic).toEqual([]);
      expect(loadShedding.steps.find((step) => step.id === "run-spike")!.demo).toEqual([
        { kind: "inject", subject: "client", count: 100 },
      ]);
      controller.selectSimulation(simulation);
      controller.setPlaying(true);
      // Reading the instructions must not use up the run's injection window.
      play(controller, 120);
      expect(controller.getState().run!.done).toBe(false);
      controller.inject(subjects.client!, 100, { spreadMs: 1500 });
      play(controller, 20);
      expect(
        holds(
          loadShedding.steps.find((step) => step.id === "run-spike")!.check,
          { diagram, live: true, session: controller.getState(), processed: () => 0 },
          subjects,
        ),
      ).toBe(true);
      expect(controller.getState().snapshot.nodes[subjects.api!].backlog).toBeGreaterThanOrEqual(24);
      expect(controller.getState().snapshot.nodes[subjects.api!].shed ?? 0).toBe(0);
      const patch = loadShedding.steps.find((step) => step.id === "cap-queue")!.demo[0];
      if (patch.kind !== "patch") throw new Error("Expected a queue-policy edit");
      const api = diagram.nodes.find((node) => node.id === subjects.api)!;
      api.props = { ...api.props, ...patchProps(api.props, patch.patches) };
      controller.updateDiagram(diagram);
      controller.selectSimulation(simulation);
      controller.setPlaying(true);
      controller.inject(subjects.client!, 100, { spreadMs: 1500 });
      play(controller, 20);
      const bounded = controller.getState().snapshot.nodes[subjects.api!];
      expect(bounded.shed).toBeGreaterThanOrEqual(24);
      expect(bounded.backlog).toBeLessThanOrEqual(10);
    } finally {
      controller.dispose();
    }
  });

  it("dead-letter replay is narration after the delivery-limit edit", () => {
    expect(deadLetters.steps.map((step) => step.id)).toEqual([
      "run-poison",
      "watch-dead-letter",
      "max-deliveries",
      "replay",
    ]);
    const replay = deadLetters.steps.at(-1)!;
    expect(replay.check).toEqual({ kind: "acknowledge" });
    expect(replay.demo).toEqual([]);
    expect(replay.goal()).toContain("no dead-letter replay action");
    expect(replay.solution.at(-1)).toEqual({ click: "tutorial-skip" });
  });
});
