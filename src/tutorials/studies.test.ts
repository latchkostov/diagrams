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
import type { Tutorial } from "./types";
import { editorHarness } from "../test/editorHarness";
import { effectiveCallerPolicy } from "../editor/callerPolicy";
import { capacitySaveCandidate } from "../live/capacityPersistence";
import { solutionNow } from "./solution";

describe("design studies", () => {
  const initial = (tutorial: Tutorial) => {
    if (typeof tutorial.start !== "function") throw new Error("Expected inline diagram");
    return tutorial.start();
  };
  const play = (live: LiveController, sample: () => void = () => {}) => {
    for (let tick = 0; tick < 48; tick++) {
      live.advance(250);
      live.publish();
      sample();
    }
  };

  it.each([studyCheckout, studyPayments, studyDispatch])(
    "$id starting diagram fails every milestone in every run",
    (tutorial) => {
      for (const simulation of initial(tutorial).simulations!) {
        const diagram = initial(tutorial);
        const live = new LiveController(diagram);
        try {
          live.selectSimulation(simulation);
          live.setPlaying(true);
          play(live, () => {
            expect(
              observeSteps(tutorial, { diagram, live: true, session: live.getState(), processed: () => 0 }),
              JSON.stringify({
                id: simulation.id,
                time: live.getState().run?.time,
                checkout: live.getState().snapshot.nodes.checkout,
              }),
            ).not.toContain(true);
          });
        } finally {
          live.dispose();
        }
      }
    },
  );

  it.each([10, 1])("partner quota rejects unpaced calls (pool: %s)", (poolConnections) => {
    const diagram = initial(studyCheckout);
    diagram.nodes.find((n) => n.id === "checkout")!.props!.replicas = 20;
    if (poolConnections)
      diagram.edges.find((e) => e.id === "checkout-payments")!.props = { caller: { poolConnections } };
    const live = new LiveController(diagram);
    try {
      live.selectSimulation(diagram.simulations!.find((s) => s.id === "partner-quota")!);
      live.setPlaying(true);
      let completed = false;
      play(live, () => {
        const session = live.getState();
        const met = observeSteps(studyCheckout, { diagram, live: true, session, processed: () => 0 })[2];
        completed ||= met;
        if (poolConnections !== 1 && session.run!.time >= 4000) {
          expect(session.snapshot.nodes.payments.processed).toBeGreaterThanOrEqual(10);
          expect(session.snapshot.nodes.payments.rejected).toBeGreaterThan(1);
          expect(met).toBe(false);
        }
      });
      expect(completed).toBe(poolConnections === 1);
    } finally {
      live.dispose();
    }
  });

  it("never-double-charge requires idempotent PSP retries", () => {
    const diagram = initial(studyPayments);
    diagram.nodes.push(
      { id: "outbox", stencil: "kafka.topic", label: "", x: 900, y: 0 },
      { id: "consumer", stencil: "service.java", label: "", x: 1200, y: 0 },
    );
    diagram.edges.push(
      { id: "outbox-write", from: "payments", to: "outbox", kind: "async" },
      { id: "outbox-read", from: "outbox", to: "consumer", kind: "async" },
    );
    const h = editorHarness(diagram);
    const met = () => observeSteps(studyPayments, { diagram: h.api.getDiagram(), live: false, processed: () => 0 })[0];
    expect(met()).toBe(false);
    const policy = effectiveCallerPolicy(h.api, "payments-psp", null)!;
    policy.set({ retry: { ...policy.caller.retry!, idempotent: true } });
    expect(met()).toBe(true);
  });

  it("brownout completion honors the Live inspector's saved-run caller overrides", () => {
    const h = editorHarness(initial(studyPayments));
    h.deps.setMeta = () => {};
    const live = new LiveController(h.api.getDiagram(), { replayDelayMs: 0 });
    try {
      live.selectSimulation(h.api.getDiagram().simulations![0]);
      const policy = () =>
        effectiveCallerPolicy(h.api, "payments-psp", { controller: live, slowmo: { active: false } })!;
      policy().set({ deadlineMs: 250, breaker: undefined, replyMs: 17 });
      expect(policy().caller.breaker).toBeNull();
      policy().set({ breaker: {} });
      expect(h.api.getEdge("payments-psp")!.props!.caller).not.toHaveProperty("deadlineMs");
      live.setPlaying(true);
      let completed = false;
      play(live, () => {
        completed ||= observeSteps(studyPayments, {
          diagram: h.api.getDiagram(),
          live: true,
          session: live.getState(),
          processed: () => 0,
        })[1];
      });
      expect(completed).toBe(true);
    } finally {
      live.dispose();
    }
  });

  it.each([false, true])("Dispatch accepts Inputs edits and capacity multipliers (saved: %s)", (save) => {
    let diagram = initial(studyDispatch);
    diagram.nodes.find((n) => n.id === "dispatcher")!.props!.replicas = 2;
    const live = new LiveController(diagram);
    try {
      live.selectSimulation(diagram.simulations![1]);
      live.setInputs({
        ...live.getState().inputs,
        props: { dispatcher: { replicas: 2 }, pings: { partitions: 4 } },
        capacity: 2,
      });
      if (save) {
        const candidate = capacitySaveCandidate(diagram, live.getState().simulation, live.getState().inputs);
        diagram = candidate.diagram;
        live.commitInputs(candidate.saved, diagram);
        live.restart();
      }
      live.setPlaying(true);
      play(live);
      const view = () => ({ diagram, live: true, session: live.getState(), processed: () => 0 });
      expect(diagram.nodes.find((n) => n.id === "dispatcher")!.props!.replicas).toBe(2);
      expect(observeSteps(studyDispatch, view())[1]).toBe(true);
      live.setInputs({ ...live.getState().inputs, props: { pings: { partitions: 3 } } });
      expect(observeSteps(studyDispatch, view())[1]).toBe(false);
      expect(observeSteps(studyDispatch, { ...view(), trafficReady: false })[1]).toBe(false);
    } finally {
      live.dispose();
    }
  });

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

  it.each([studyDispatch, studyPayments, studyFanout, studyRag, studyCells])(
    "publishes $id with its generated browser cases",
    (study) => {
      expect(study.quarantined).toBeUndefined();
      expect(findTutorial(study.id)).toBe(study);
      expect(tutorials).toContain(study);
      expect(tutorialMetadata.some((entry) => entry.id === study.id)).toBe(true);
      expect(tutorialEntries.find((entry) => entry.id === study.id)).toEqual({ id: study.id });
    },
  );

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
            live.updateDiagram(diagram);
            view.session = live.getState();
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
