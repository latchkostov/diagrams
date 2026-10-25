import { describe, expect, it } from "vitest";
import { createMachine, machinePaths } from "../lib/machine";
import { validateDiagram } from "../interop/native";
import { LiveController } from "../live/controller";
import { allTutorials, findTutorial } from "./catalog";
import { studyCheckout } from "./catalog/studyCheckout";
import { studyDispatch } from "./catalog/studyDispatch";
import { studyPayments } from "./catalog/studyPayments";
import { observeSteps, resolveSubjects } from "./checks";
import { runnerInitial, runnerMachine, targetsShown } from "./machine";
import { solutionNow } from "./solution";

describe("design studies", () => {
  it("checkout reference fleet passes the seeded rush", () => {
    if (typeof studyCheckout.start !== "function") throw new Error("Expected inline diagram");
    const diagram = studyCheckout.start();
    diagram.nodes.find((node) => node.id === "checkout")!.props!.replicas = 20;
    const live = new LiveController(diagram);
    try {
      expect(live.selectSimulation(diagram.simulations![0])).toBe("selected");
      live.setPlaying(true);
      for (let tick = 0; tick < 24; tick++) live.advance(250);
      live.publish();
      const session = live.getState();
      expect(
        observeSteps(studyCheckout, { diagram, live: true, session, processed: () => 0 })[0],
        JSON.stringify({ nodes: session.snapshot.nodes, run: session.run }),
      ).toBe(true);
    } finally {
      live.dispose();
    }
  });
  for (const tutorial of [studyCheckout, studyDispatch, studyPayments]) {
    it(`${tutorial.id} resolves every milestone's whole solution before its edits begin`, () => {
      if (typeof tutorial.start !== "function") throw new Error("Expected an inline practice diagram");
      const subjects = resolveSubjects(tutorial, tutorial.start());
      tutorial.steps.forEach((step, index) => {
        const snapshot = {
          state: {
            ...runnerInitial(
              tutorial.steps.map(() => false),
              { highlights: true, resumeAt: 0 },
            ),
            value: "active" as const,
            index,
          },
          subjects: { ...subjects },
          selected: [],
          announcement: "",
          nearMiss: null,
          edges: {},
        };
        expect(() => solutionNow(tutorial, snapshot)).not.toThrow();
        // Only predecessors have made their nodes when this milestone's path is requested.
        for (const demo of step.demo) if (demo.kind === "add") subjects[demo.subject] = `made-${demo.subject}`;
      });
    });
    it(`${tutorial.id} registers a valid, unfinished practice diagram and a reference`, () => {
      expect(allTutorials).toContain(tutorial);
      expect(tutorial).toMatchObject({ study: true, track: "studies", level: 3 });
      expect(tutorial.minutes).toBeGreaterThanOrEqual(15);
      expect(tutorial.minutes).toBeLessThanOrEqual(25);
      if (typeof tutorial.start !== "function") throw new Error("Expected an inline practice diagram");
      const diagram = tutorial.start();
      expect(validateDiagram(diagram)).toMatchObject({ ok: true });
      expect(observeSteps(tutorial, { diagram, live: false, processed: () => 0 })).not.toContain(true);
      expect(tutorial.finish.example?.slug).toBeTruthy();
      for (const step of tutorial.steps) {
        expect(["all", "expectation", "metric"]).toContain(step.check.kind);
        expect(step.hint?.()).toBeTruthy();
        expect(step.demo.length).toBeGreaterThan(0);
      }
    });
  }

  it("offers checkout and payments while dispatch awaits owner decision 7", () => {
    expect(findTutorial("study-checkout")).toBe(studyCheckout);
    expect(findTutorial("study-payments")).toBe(studyPayments);
    expect(studyDispatch.quarantined).toBe(true);
    expect(findTutorial("study-dispatch")).toBeUndefined();
  });

  it("shows study targets only while hinting across the runner's reachable paths", () => {
    const definition = {
      ...runnerMachine,
      initial: runnerInitial([false, true], { highlights: true, resumeAt: 0 }),
    };
    for (const path of machinePaths(definition, { maxDepth: 4 })) {
      const machine = createMachine(definition);
      for (const event of path.events) {
        machine.send(event);
        expect(targetsShown(machine.state, true)).toBe(machine.state.value === "hinting");
      }
    }
  });
});
