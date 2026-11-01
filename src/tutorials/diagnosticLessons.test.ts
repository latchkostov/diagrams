/* eslint-disable local/no-literal-ui-text -- Deliberate near misses and synthetic display labels. */
import { describe, expect, it } from "vitest";
import { LiveController } from "../live/controller";
import type { DiagramFile, Simulation } from "../model/types";
import { stencilRole } from "../stencils/roles";
import { backlogScalingPractice, breakerPractice, deadLetterPractice } from "../lab/waitingPractice";
import { holds, resolveSubjects, type SandboxView } from "./checks";
import { authoredSimulation, matchesExpectation, matchesSimulation } from "./simulations";
import { scaleOnBacklog } from "./catalog/scaleOnBacklog";
import { circuitBreaker } from "./catalog/circuitBreaker";
import { deadLetters } from "./catalog/deadLetters";
import { timeoutsPools } from "./catalog/timeoutsPools";
import type { Check, Tutorial } from "./types";

const checks = (c: Check): Check[] => (c.kind === "all" ? c.checks.flatMap(checks) : [c]);
function setup(lesson: Tutorial, id: string, diagram?: DiagramFile) {
  const d = diagram ?? (lesson.start as () => DiagramFile)();
  const c = new LiveController(d, { roleOf: stencilRole });
  const subjects = resolveSubjects(lesson, d);
  const sim = () => d.simulations!.find((s) => s.id === id)!;
  const select = () => {
    c.selectSimulation(sim());
    c.setPlaying(true);
  };
  select();
  const view = (subject?: string): SandboxView => ({
    diagram: d,
    live: true,
    session: c.getState(),
    sessionId: 0,
    processed: (id) => c.getState().snapshot.nodes[id]?.processed ?? 0,
    readout: subject ? { kind: "node", id: subjects[subject]! } : null,
  });
  const met = (step: string, subject?: string, v = view(subject)) =>
    holds(lesson.steps.find((s) => s.id === step)!.check, v, subjects);
  const play = (ms: number) => {
    for (let t = 0; t < ms; t += 10) c.advance(10);
    c.publish();
  };
  return { d, c, subjects, view, met, play, select, sim };
}

describe("diagnose waiting with real semantic evidence", () => {
  it("holds Starting separately from Ready and demonstrates the partition ceiling with backlog", () => {
    const s = setup(scaleOnBacklog, "wake-on-burst");
    try {
      expect(s.met("starting", "worker")).toBe(false);
      s.play(6000);
      expect(s.c.getState().run?.time).toBe(2500);
      expect(s.met("starting")).toBe(false);
      expect(s.met("starting", "broker")).toBe(false);
      expect(s.met("starting", "worker")).toBe(true);
      expect(s.met("ready", "worker")).toBe(false);
      expect(s.met("ceiling", "broker")).toBe(false);
      s.c.resume();
      s.play(6000);
      expect(s.c.getState().run?.time).toBe(4000);
      expect(s.met("starting", "worker")).toBe(false);
      expect(s.met("ready", "worker")).toBe(true);
      expect(s.met("ceiling", "broker")).toBe(true);
      const reading = s.c.getState().snapshot.nodes["render-workers"];
      expect(reading.fleet?.ready).toBe(3);
      expect(s.c.getState().snapshot.nodes["render-requests"].backlog).toBeGreaterThan(1 / 0.7);
      const v = s.view("broker");
      expect(
        s.met("ceiling", "broker", {
          ...v,
          session: {
            ...v.session!,
            snapshot: {
              ...v.session!.snapshot,
              nodes: {
                ...v.session!.snapshot.nodes,
                "render-requests": { ...v.session!.snapshot.nodes["render-requests"], backlog: 0 },
              },
            },
          },
        }),
      ).toBe(false);
      expect(s.met("drained")).toBe(false);
    } finally {
      s.c.dispose();
    }
  });
  it("requires six effective partitions and a fresh 80-job run, independent of expectation IDs", () => {
    const d = backlogScalingPractice();
    d.nodes.find((n) => n.id === "render-requests")!.props!.partitions = 6;
    const run = d.simulations![0];
    run.expectations = run.expectations!.map((e, i) => ({ ...e, id: `mine-${i}`, label: `My check ${i}` }));
    const s = setup(scaleOnBacklog, "wake-on-burst", d);
    try {
      const baseline = [0, s.c.getState().generation, 0] as const;
      expect(s.met("replay", undefined, { ...s.view(), baseline: { newRun: baseline } })).toBe(false);
      s.select();
      expect(s.met("replay", undefined, { ...s.view(), baseline: { newRun: baseline } })).toBe(true);
      s.play(3000);
      s.c.resume();
      s.play(3000);
      s.c.resume();
      s.play(10000);
      expect(s.c.getState().snapshot.nodes["render-workers"].processed).toBe(80);
      expect(s.met("drained")).toBe(true);
      const v = s.view();
      const wrong = {
        ...v.session!.running!,
        expectations: v.session!.running!.expectations!.map((e) => ({ ...e, value: e.value + 1 })),
      };
      expect(s.met("drained", undefined, { ...v, session: { ...v.session!, running: wrong } })).toBe(false);
      expect(
        s.met("drained", undefined, {
          ...v,
          session: {
            ...v.session!,
            configuration: { ...v.session!.configuration, "render-requests": { partitions: 3 } },
          },
        }),
      ).toBe(false);
    } finally {
      s.c.dispose();
    }
  });
  it("holds the real Open and Testing states and rejects initial Closed as recovery", () => {
    const s = setup(circuitBreaker, "circuit-breaker", breakerPractice());
    try {
      expect(s.met("closed")).toBe(false);
      s.play(20000);
      expect(s.c.getState().run?.time).toBe(9000);
      expect(s.met("open")).toBe(true);
      expect(s.met("testing")).toBe(false);
      s.c.resume();
      s.play(20000);
      expect(s.c.getState().run?.time).toBe(10500);
      expect(s.met("testing")).toBe(true);
      s.c.resume();
      s.play(50000);
      expect(s.met("closed")).toBe(true);
      expect(s.met("recovered")).toBe(true);
    } finally {
      s.c.dispose();
    }
  });
  it("checks caller deadline, pool occupancy and late callee work separately", () => {
    const d = (timeoutsPools.start as () => DiagramFile)();
    d.edges.find((e) => e.id === "pay")!.props = { caller: { deadlineMs: 600 } };
    const s = setup(timeoutsPools, "pool-40", d);
    try {
      expect(s.met("run-pool-40")).toBe(false);
      s.play(5000);
      expect(s.met("run-pool-40")).toBe(false); // Timeouts exist before any late provider work finishes.
      s.play(5000);
      expect(s.met("run-pool-40")).toBe(true);
      const v = s.view();
      const calls = v.session!.snapshot.edges.pay.calls!;
      expect(calls.inFlight).toBeLessThanOrEqual(40);
      expect(calls.timedOut).toBeGreaterThan(0);
      expect(calls.late).toBeGreaterThan(0);
      for (const bad of [{ late: 0 }, { timedOut: 0 }, { inFlight: 41 }]) {
        expect(
          s.met("run-pool-40", undefined, {
            ...v,
            session: {
              ...v.session!,
              snapshot: {
                ...v.session!.snapshot,
                edges: {
                  ...v.session!.snapshot.edges,
                  pay: { ...v.session!.snapshot.edges.pay, calls: { ...calls, ...bad } },
                },
              },
            },
          }),
        ).toBe(false);
      }
    } finally {
      s.c.dispose();
    }
  });
  it("requires a fresh command trace dead-lettering on the configured third delivery", () => {
    const d = deadLetterPractice();
    d.nodes.find((n) => n.id === "commands")!.props!.maxDeliveryCount = 3;
    const s = setup(deadLetters, "poison", d);
    try {
      expect(s.met("verify-limit")).toBe(false);
      s.play(10000);
      s.c.traceDeadLettered();
      s.c.publish();
      expect(s.met("verify-limit")).toBe(true);
      const v = s.view();
      const trace = v.session!.trace!;
      for (const bad of [{ node: "posting-sub" }, { attempt: 5 }]) {
        expect(
          s.met("verify-limit", undefined, {
            ...v,
            session: {
              ...v.session!,
              trace: {
                ...trace,
                current: {
                  ...trace.current!,
                  steps: trace.current!.steps.map((step) => (step.kind === "deadletter" ? { ...step, ...bad } : step)),
                },
              },
            },
          }),
        ).toBe(false);
      }
    } finally {
      s.c.dispose();
    }
  });
});

describe("semantic reconstruction and near-miss repair", () => {
  it("matches metric, operator, value, target and exact observation time", () => {
    const e = {
      id: "generated",
      label: "Mine",
      metric: { node: "commands", field: "deadLettered" as const },
      op: ">" as const,
      value: 0,
      when: "at" as const,
      atMs: 1000,
    };
    expect(matchesExpectation(e, { ...e, id: "other", label: "Other" } as typeof e)).toBe(true);
    for (const bad of [
      { atMs: 2000 },
      { when: "end" as const },
      { value: 1 },
      { op: "<" as const },
      { metric: { node: "other", field: "deadLettered" as const } },
    ])
      expect(matchesExpectation({ ...e, ...bad }, e)).toBe(false);
  });
  it.each([scaleOnBacklog, circuitBreaker, deadLetters, timeoutsPools])(
    "%s restores authored runs and repairs wrong note targets/times in place",
    (lesson) => {
      for (const step of lesson.steps)
        for (const demo of step.demo) {
          if (demo.kind !== "saveSimulation" || !demo.definition) continue;
          const d = (lesson.start as () => DiagramFile)();
          const own = structuredClone(demo.definition);
          own.traffic[0].node = "wrong-target";
          const note = own.timeline?.find((s) => s.action.do === "note");
          if (note?.action.do === "note") {
            note.atMs += 1;
            note.action.focus = ["wrong-target"];
          }
          const fixed = authoredSimulation(d, own, demo)!;
          expect(fixed.traffic).toEqual(demo.definition.traffic);
          expect(fixed.timeline).toHaveLength(demo.definition.timeline?.length ?? 0);
          expect(fixed.timeline).toEqual(demo.definition.timeline);
          const c = checks(step.check).find((c) => c.kind === "simulation" && c.saved);
          if (c?.kind === "simulation" && c.saved) {
            expect(matchesSimulation(fixed, c.saved)).toBe(true);
            expect(matchesSimulation(own, c.saved)).toBe(false);
          }
          expect(authoredSimulation(d, fixed, demo)).toBeNull();
        }
    },
  );
  it("repairs an expectation's target and time without duplicating its generated identity", () => {
    const d = backlogScalingPractice();
    const reference = d.simulations![0];
    const own: Simulation = structuredClone(reference);
    own.expectations![0] = { ...own.expectations![0], id: "my-id", metric: { node: "wrong", field: "lag" }, atMs: 999 };
    const fixed = authoredSimulation(d, own, {
      kind: "saveSimulation",
      id: reference.id,
      title: () => reference.title,
      definition: reference,
    })!;
    expect(fixed.expectations).toHaveLength(reference.expectations!.length);
    expect(fixed.expectations![0].id).toBe("my-id");
    expect(matchesExpectation(fixed.expectations![0], reference.expectations![0])).toBe(true);
  });
});
