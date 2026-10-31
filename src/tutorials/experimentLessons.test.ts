/* eslint-disable local/no-literal-ui-text -- Deliberate near-miss test input. */
import { describe, expect, it } from "vitest";
import { LiveController } from "../live/controller";
import { experimentDefinition, experimentPractice, resourcePractice } from "../lab/simulationPractice";
import { configuredPlanning } from "../planning/cache";
import { holds, resolveSubjects, type SandboxView } from "./checks";
import { matchesSimulation } from "./simulations";
import { authorASimulation } from "./catalog/authorASimulation";
import { readANode } from "./catalog/readANode";
import { resourceHeadroom } from "./catalog/resourceHeadroom";
import type { Check, SimulationMatch } from "./types";

const source = { documentId: "practice", identity: {} };
function matchAt(id: string): SimulationMatch {
  const check = authorASimulation.steps.find((s) => s.id === id)!.check;
  if (check.kind !== "savedSimulation" && check.kind !== "draftSimulation")
    throw new Error("Definition check expected");
  return check.match;
}
function advance(c: LiveController, frames = 60) {
  c.setPlaying(true);
  for (let i = 0; i < frames; i++) c.advance(100);
  c.publish();
}
describe("experiment definition evidence", () => {
  it("requires the ten-job draft, with its seed, length and scale, separately from a save", () => {
    const sim = experimentDefinition();
    const match = matchAt("burst");
    expect(matchesSimulation(sim, match)).toBe(true);
    for (const bad of [
      { ...sim, seed: 8 },
      { ...sim, scale: 2 },
      { ...sim, durationMs: 1 },
      { ...sim, multipliers: { traffic: 2 } },
      { ...sim, multipliers: { capacity: 2 } },
      {
        ...sim,
        traffic: [{ ...sim.traffic[0], shape: { kind: "burst" as const, count: 9, atMs: 0, spreadMs: 1000 } }],
      },
      { ...sim, traffic: [{ ...sim.traffic[0], node: "worker" }] },
    ])
      expect(matchesSimulation(bad, match)).toBe(false);
    const diagram = experimentPractice();
    const c = new LiveController(diagram);
    try {
      c.selectSimulation(sim);
      const view: SandboxView = { diagram, live: true, session: c.getState(), draft: sim, processed: () => 0 };
      const draft: Check = { kind: "draftSimulation", match };
      expect(holds(draft, view, {})).toBe(true);
      diagram.simulations = [sim];
      expect(holds(draft, view, {})).toBe(false);
      expect(holds({ kind: "savedSimulation", match }, view, {})).toBe(true);
    } finally {
      c.dispose();
    }
  });
  it("rejects an unpaused note, wrong focus/time, empty prose and a different expectation definition", () => {
    const sim = experimentDefinition(true, true);
    expect(matchesSimulation(sim, matchAt("save"))).toBe(true);
    for (const bad of [
      {
        ...sim,
        timeline: [{ atMs: 500, action: { do: "note" as const, text: "Observe", focus: ["queue"], pause: true } }],
      },
      {
        ...sim,
        timeline: [{ atMs: 500, action: { do: "note" as const, text: "Observe", focus: ["worker"], pause: false } }],
      },
      {
        ...sim,
        timeline: [{ atMs: 0, action: { do: "note" as const, text: "Observe", focus: ["worker"], pause: true } }],
      },
      { ...sim, timeline: [{ atMs: 500, action: { do: "note" as const, text: " ", focus: ["worker"], pause: true } }] },
      ...[
        { when: "always" as const },
        { value: 9 },
        { op: "<=" as const },
        { metric: { node: "queue", field: "processed" as const } },
      ].map((p) => ({ ...sim, expectations: [{ ...sim.expectations![0], ...p }] })),
    ])
      expect(matchesSimulation(bad, matchAt("save"))).toBe(false);
    const ownWords = structuredClone(sim);
    if (ownWords.timeline![0].action.do === "note") ownWords.timeline![0].action.text = "My prediction";
    expect(matchesSimulation(ownWords, matchAt("save"))).toBe(true);
  });
  it.each(["check", "check-2"])(
    "holds the authored %s end expectation and repeats its result only in a new generation",
    (id) => {
      const diagram = experimentPractice();
      const sim = experimentDefinition(true, true);
      sim.expectations![0] = { ...sim.expectations![0], id, label: "My expected completions" };
      diagram.simulations = [sim];
      const c = new LiveController(diagram);
      const subjects = resolveSubjects(authorASimulation, diagram);
      const view = (): SandboxView => ({
        diagram,
        live: true,
        session: c.getState(),
        sessionId: 1,
        processed: (id) => c.getState().snapshot.nodes[id]?.processed ?? 0,
      });
      try {
        c.selectSimulation(sim);
        advance(c);
        expect(c.getState().run?.waiting).toBe(true);
        expect(c.getState().run?.expectations[0].status).toBe("pending");
        const pause = authorASimulation.steps.find((s) => s.id === "pause")!.check;
        const paused = {
          ...view(),
          baseline: { newRun: [0, c.getState().generation - 1, 1] as const },
        };
        expect(holds(pause, { ...paused, views: { simulations: true } }, subjects)).toBe(false);
        expect(holds(pause, { ...paused, views: { simulations: false } }, subjects)).toBe(true);
        c.resume();
        advance(c);
        expect(c.getState().snapshot.nodes.worker.processed).toBe(10);
        const result = authorASimulation.steps.find((s) => s.id === "result")!.check;
        expect(holds(result, view(), subjects)).toBe(true);
        const changedDemand = () => ({ ...c.getState(), running: { ...sim, multipliers: { traffic: 2 } } });
        expect(holds(result, { ...view(), session: changedDemand() }, subjects)).toBe(false);
        const base = [0, c.getState().generation, 1] as const;
        expect(holds({ kind: "newRun" }, { ...view(), baseline: { newRun: base } }, subjects)).toBe(false);
        c.selectSimulation(sim);
        advance(c);
        c.resume();
        advance(c);
        expect(holds(result, view(), subjects)).toBe(true);
        expect(holds({ kind: "newRun" }, { ...view(), baseline: { newRun: base } }, subjects)).toBe(true);
        const replay = authorASimulation.steps.find((s) => s.id === "replay")!.check;
        expect(holds(replay, { ...view(), baseline: { newRun: base } }, subjects)).toBe(true);
        expect(holds(replay, { ...view(), session: changedDemand(), baseline: { newRun: base } }, subjects)).toBe(
          false,
        );
      } finally {
        c.dispose();
      }
    },
  );
});
describe("capacity evidence", () => {
  it("keeps CPU binding while replicas double capacity, and higher traffic changes offered demand", () => {
    const diagram = resourcePractice();
    const sim = diagram.simulations![0];
    const c = new LiveController(diagram);
    try {
      c.selectSimulation(sim);
      const first = configuredPlanning(diagram, c.getState())!.explanation("worker")!;
      expect(first.capacity).toBe(5);
      expect(first.offered).toBe(20);
      c.setPlaying(true);
      for (let i = 0; i < 10; i++) c.advance(100);
      c.publish();
      expect(c.getState().snapshot.nodes.queue.backlog).toBeGreaterThan(0);
      diagram.nodes[2].props = { ...diagram.nodes[2].props, replicas: 2 };
      c.updateDiagram(diagram);
      c.selectSimulation(sim);
      advance(c);
      expect(c.getState().snapshot.nodes.worker.processed).toBe(20);
      expect(c.getState().snapshot.nodes.queue.backlog).toBe(0);
      c.setInputs({ ...c.getState().inputs, traffic: 2 });
      const higher = configuredPlanning(diagram, c.getState())!.explanation("worker")!;
      expect(higher.capacity).toBe(10);
      expect(higher.offered).toBe(40);
      const subjects = resolveSubjects(resourceHeadroom, diagram);
      const check: Check = { kind: "planning", subject: "worker", constraint: "cpu", capacity: 10, offered: 40 };
      const view: SandboxView = {
        diagram,
        live: true,
        processed: () => 0,
        observations: { planning: { ...source, nodeId: "worker", constraint: "cpu", capacity: 10, offered: 40 } },
      };
      expect(holds(check, view, subjects)).toBe(true);
      for (const bad of [{ nodeId: "queue" }, { constraint: "threads" as const }, { capacity: 5 }, { offered: 20 }])
        expect(
          holds(check, { ...view, observations: { planning: { ...view.observations!.planning!, ...bad } } }, subjects),
        ).toBe(false);
    } finally {
      c.dispose();
    }
  });
});

it("requires Sequence and successful export bytes to belong to the currently traced root", () => {
  const d = experimentPractice();
  const c = new LiveController(d);
  try {
    c.selectSimulation(experimentDefinition());
    c.traceNext("client");
    advance(c);
    const traceId = c.getState().trace!.current!.rootId;
    const view: SandboxView = {
      diagram: d,
      live: true,
      session: c.getState(),
      processed: () => 0,
      observations: {
        sequence: { ...source, traceId, open: true, arrows: 2 },
        sequenceExport: { ...source, traceId, format: "svg", bytes: 20 },
      },
    };
    const check: Check = { kind: "sequence", exported: "svg" };
    expect(holds(check, view, {})).toBe(true);
    for (const bad of [{ traceId: traceId + 1 }, { bytes: 0 }, { format: "png" as const }])
      expect(
        holds(
          check,
          {
            ...view,
            observations: { ...view.observations, sequenceExport: { ...view.observations!.sequenceExport!, ...bad } },
          },
          {},
        ),
      ).toBe(false);
    expect(
      holds(
        check,
        { ...view, observations: { ...view.observations, sequence: { ...view.observations!.sequence!, open: false } } },
        {},
      ),
    ).toBe(false);
  } finally {
    c.dispose();
  }
});

it("a Drill matches its preset, target, time and kind on one timeline action", () => {
  const base = experimentDefinition();
  const match: SimulationMatch = { drill: "slow-dependency", fault: { node: "worker", atMs: 0, kind: "slow" } };
  const sim = {
    ...base,
    timeline: [
      {
        atMs: 0,
        action: {
          do: "fault" as const,
          drill: "slow-dependency" as const,
          fault: { kind: "slow" as const, node: "worker", factor: 5 as const },
        },
      },
    ],
  };
  expect(matchesSimulation(sim, match)).toBe(true);
  expect(matchesSimulation({ ...sim, timeline: [{ ...sim.timeline[0], atMs: 1000 }] }, match)).toBe(false);
  expect(
    matchesSimulation(
      {
        ...sim,
        timeline: [
          {
            ...sim.timeline[0],
            action: { ...sim.timeline[0].action, fault: { kind: "slow", node: "queue", factor: 5 } },
          },
        ],
      },
      match,
    ),
  ).toBe(false);
  expect(
    matchesSimulation(
      {
        ...sim,
        timeline: [
          {
            atMs: 0,
            action: { do: "fault", drill: "slow-dependency", fault: { kind: "slow", node: "queue", factor: 5 } },
          },
          { atMs: 0, action: { do: "fault", fault: { kind: "fail", node: "worker", rate: 0.5 } } },
        ],
      },
      match,
    ),
  ).toBe(false);
});

it("an ended resource run can configure its next replicas before the pending fleet gets another tick", () => {
  const diagram = resourcePractice();
  const c = new LiveController(diagram);
  const subjects = resolveSubjects(resourceHeadroom, diagram);
  try {
    c.selectSimulation(diagram.simulations![0]);
    advance(c);
    expect(c.getState().run!.done).toBe(true);
    diagram.nodes[2].props = { ...diagram.nodes[2].props, replicas: 2 };
    c.updateDiagram(diagram);
    const view: SandboxView = { diagram, live: true, session: c.getState(), processed: () => 0 };
    const configure = resourceHeadroom.steps.find((step) => step.id === "replicas")!.check;
    expect(c.getState().snapshot.nodes.worker.fleet!.ready).toBe(1);
    expect(holds(configure, view, subjects)).toBe(true);
    const wrong = structuredClone(diagram);
    wrong.nodes[2].props!.replicas = 1;
    expect(holds(configure, { ...view, diagram: wrong }, subjects)).toBe(false);
    c.selectSimulation(diagram.simulations![0]);
    advance(c);
    expect(c.getState().snapshot.nodes.worker.fleet!.ready).toBe(2);
    expect(c.getState().snapshot.nodes.worker.processed).toBe(20);
  } finally {
    c.dispose();
  }
});

it("the same-burst replay rejects changes to effective Traffic, capacity or sampling Scale", () => {
  const diagram = resourcePractice();
  const c = new LiveController(diagram);
  const subjects = resolveSubjects(resourceHeadroom, diagram);
  try {
    c.selectSimulation(diagram.simulations![0]);
    const baseline = { newRun: [0, c.getState().generation, 1] as const };
    diagram.nodes[2].props = { ...diagram.nodes[2].props, replicas: 2 };
    c.updateDiagram(diagram);
    c.selectSimulation(diagram.simulations![0]);
    advance(c);
    const view: SandboxView = {
      diagram,
      live: true,
      session: c.getState(),
      sessionId: 1,
      baseline,
      processed: (id) => c.getState().snapshot.nodes[id]?.processed ?? 0,
    };
    const replay = resourceHeadroom.steps.find((step) => step.id === "replay")!.check;
    expect(holds(replay, view, subjects)).toBe(true);
    for (const input of ["traffic", "capacity", "scale"] as const)
      expect(
        holds(
          replay,
          { ...view, session: { ...view.session!, inputs: { ...view.session!.inputs, [input]: 2 } } },
          subjects,
        ),
      ).toBe(false);
  } finally {
    c.dispose();
  }
});

it("read-a-node advertises the Properties route its readout check requires", () => {
  const step = readANode.steps.find((s) => s.id === "readout")!;
  expect(step.goal()).toContain("open Properties (double-click or F2)");
  expect(step.goal()).not.toMatch(/hover/i);
});

it.each(["result", "replay"])(
  "%s checks the outcome of the matching definition rather than another passing chip",
  (stepId) => {
    const diagram = experimentPractice();
    const sim = experimentDefinition(false, true);
    const required = { ...sim.expectations![0], id: "check-2", label: "My prediction" };
    sim.expectations = [{ ...required, id: "check", label: "check", value: 0 }, required];
    diagram.simulations = [sim];
    const c = new LiveController(diagram);
    try {
      c.selectSimulation(sim);
      advance(c);
      const all = authorASimulation.steps.find((s) => s.id === stepId)!.check;
      if (all.kind !== "all") throw new Error("Expected result checks");
      const check = all.checks.find((check) => check.kind === "expectation")!;
      const session = c.getState();
      const view: SandboxView = { diagram, live: true, session, processed: () => 0 };
      expect(session.run!.expectations.map((e) => e.status)).toEqual(["pass", "pass"]);
      expect(holds(check, view, {})).toBe(true);
      for (const status of ["pending", "fail"] as const) {
        const run = {
          ...session.run!,
          expectations: session.run!.expectations.map((e) => (e.id === required.id ? { ...e, status } : e)),
        };
        expect(holds(check, { ...view, session: { ...session, run } }, {})).toBe(false);
      }
    } finally {
      c.dispose();
    }
  },
);
