import { describe, expect, it } from "vitest";
import { createMachine, machinePaths } from "../lib/machine";
import { validateDiagram } from "../interop/native";
import { LiveController } from "../live/controller";
import { allTutorials, findTutorial, tutorials } from "./catalog";
import { tutorialEntries } from "./catalog/ids";
import { tutorialMetadata } from "./metadata";
import { studyCheckout } from "./catalog/studyCheckout";
import { studyDispatch } from "./catalog/studyDispatch";
import { studyPayments } from "./catalog/studyPayments";
import { studyFanout } from "./catalog/studyFanout";
import { studyRag } from "./catalog/studyRag";
import { studyCells } from "./catalog/studyCells";
import { edgeTargets, observeSteps, resolveSubjects } from "./checks";
import { runnerInitial, runnerMachine, targetsShown } from "./machine";
import { solutionNow } from "./solution";

describe("design studies", () => {
  it.each([
    ["booking", "neighbour"],
    ["neighbour", "booking"],
  ])("cells bind boundaries by membership when %s is grouped before %s", (first, second) => {
    if (typeof studyCells.start !== "function") throw new Error("Expected inline diagram");
    const diagram = studyCells.start();
    diagram.nodes.push({ id: "java", stencil: "service.java", label: "", x: 950, y: 250 });
    diagram.edges.push({ id: "java-request", from: "east", to: "java", kind: "sync" });
    let subjects = resolveSubjects(studyCells, diagram);
    for (const [index, name] of [first, second].entries()) {
      const id = `boundary-${index}`;
      diagram.groups = [...(diagram.groups ?? []), { id, label: "", x: 900, y: index * 500, width: 400, height: 300 }];
      diagram.nodes.find((node) => node.id === subjects[name])!.group = id;
      subjects = resolveSubjects(studyCells, diagram, subjects);
      expect(subjects[name === "booking" ? "cellA" : "cellB"]).toBe(id);
      if (index === 0) expect(subjects[name === "booking" ? "cellB" : "cellA"]).toBeUndefined();
    }
    expect(observeSteps(studyCells, { diagram, live: false, processed: () => 0 }, subjects)[0]).toBe(true);
  });

  it.each([1, 2])("Dispatch dinner rush requires a working fleet (%i replicas)", (replicas) => {
    if (typeof studyDispatch.start !== "function") throw new Error("Expected inline diagram");
    const diagram = studyDispatch.start();
    if (replicas !== 1) diagram.nodes.find((node) => node.id === "dispatcher")!.props!.replicas = replicas;
    const simulation = diagram.simulations!.find((run) => run.id === "dinner-rush")!;
    const live = new LiveController(diagram);
    try {
      expect(live.selectSimulation(simulation)).toBe("selected");
      live.setPlaying(true);
      let completed = false;
      for (let tick = 0; tick < 48; tick++) {
        live.advance(250);
        live.publish();
        completed ||= observeSteps(studyDispatch, {
          diagram,
          live: true,
          session: live.getState(),
          processed: () => 0,
        })[0];
      }
      expect(completed, "the untouched starting fleet must never latch the milestone").toBe(replicas === 2);
      expect(live.getState().run!.expectations).toContainEqual(
        expect.objectContaining({ id: "bounded", status: replicas === 2 ? "pass" : "fail" }),
      );
    } finally {
      live.dispose();
    }
  });

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
  for (const tutorial of [studyCheckout, studyDispatch, studyPayments, studyFanout, studyRag, studyCells]) {
    it(`${tutorial.id} resolves every milestone's whole solution before its edits begin`, () => {
      if (typeof tutorial.start !== "function") throw new Error("Expected an inline practice diagram");
      const initial = tutorial.start();
      const subjects = resolveSubjects(tutorial, initial);
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
          edges: edgeTargets(initial, subjects),
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

  it("quarantines five design studies while retaining their milestone coverage", () => {
    for (const study of [studyCheckout, studyDispatch, studyPayments, studyFanout, studyRag]) {
      expect(study.quarantined).toBe(true);
      expect(findTutorial(study.id)).toBeUndefined();
      expect(tutorials).not.toContain(study);
      expect(tutorialMetadata.some((entry) => entry.id === study.id)).toBe(false);
      expect(tutorialEntries.find((entry) => entry.id === study.id)).toEqual({
        id: study.id,
        quarantined: true,
      });
    }
  });

  it("keeps the membership-based Cells study published", () => {
    expect(studyCells.quarantined).toBeUndefined();
    expect(findTutorial(studyCells.id)).toBe(studyCells);
    expect(tutorials).toContain(studyCells);
    expect(tutorialMetadata.some((entry) => entry.id === studyCells.id)).toBe(true);
    expect(tutorialEntries.find((entry) => entry.id === studyCells.id)).toEqual({ id: studyCells.id });
  });

  it.each([true, false])("Dispatch partition fix requires processed traffic (connected: %s)", (connected) => {
    if (typeof studyDispatch.start !== "function") throw new Error("Expected inline diagram");
    const diagram = studyDispatch.start();
    diagram.nodes.find((node) => node.id === "dispatcher")!.props!.replicas = 4;
    diagram.nodes.find((node) => node.id === "pings")!.props!.partitions = 4;
    if (!connected) diagram.edges = diagram.edges.filter((edge) => edge.id !== "couriers-pings");
    const simulation = diagram.simulations!.find((run) => run.id === "more-partitions")!;
    const live = new LiveController(diagram);
    try {
      expect(live.selectSimulation(simulation)).toBe("selected");
      live.setPlaying(true);
      let completed = false;
      for (let tick = 0; tick < 48; tick++) {
        live.advance(250);
        live.publish();
        completed ||= observeSteps(studyDispatch, {
          diagram,
          live: true,
          session: live.getState(),
          processed: () => 0,
        })[1];
      }
      expect(live.getState().run!.expectations).toContainEqual(
        expect.objectContaining({ id: "bounded", status: "pass" }),
      );
      expect(completed, "an empty topic cannot prove the partition fix works").toBe(connected);
    } finally {
      live.dispose();
    }
  });

  it("Dispatch judges each run by its own saved expectation and requires partitions ≥ consumers", () => {
    if (typeof studyDispatch.start !== "function") throw new Error("Expected inline diagram");
    for (const [index, id] of ["dinner-rush", "more-partitions"].entries())
      for (const passingExpectation of [true, false]) {
        const diagram = studyDispatch.start();
        diagram.nodes.find((node) => node.id === "dispatcher")!.props!.replicas = 4;
        diagram.nodes.find((node) => node.id === "pings")!.props!.partitions = 4;
        const simulation = diagram.simulations!.find((run) => run.id === id)!;
        if (!passingExpectation) simulation.expectations![0].value = -1;
        const live = new LiveController(diagram);
        try {
          expect(live.selectSimulation(simulation)).toBe("selected");
          live.setPlaying(true);
          for (let tick = 0; tick < 16; tick++) live.advance(250);
          live.publish();
          const view = { diagram, live: true, session: live.getState(), processed: () => 0 };
          const met = observeSteps(studyDispatch, view);
          expect(met[index], `${id}: own expectation ${passingExpectation}`).toBe(passingExpectation);
          expect(met[1 - index], "another run's result cannot complete this milestone").toBe(false);
          if (index === 1 && passingExpectation) {
            diagram.nodes.find((node) => node.id === "pings")!.props!.partitions = 3;
            expect(observeSteps(studyDispatch, view)[index], "unassigned consumers cannot satisfy the fix").toBe(false);
          }
        } finally {
          live.dispose();
        }
      }
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
