import { expect, it } from "vitest";
import { waitingFixture } from "../lab/waitingFixture";
import { createSimulationRun } from "./simulation";
import { realSnapshot } from "./units";
import { simulationProblem, validateDiagram } from "../interop/native";

it.each([1, 10])("thread expectation metrics match the real-unit meter at scale %s", (scale) => {
  const d = waitingFixture();
  const run = createSimulationRun(d, {
    id: "threads",
    title: "Threads",
    scale,
    seed: 1,
    durationMs: 1000,
    traffic: [{ id: "burst", node: "source", shape: { kind: "burst", count: 40 } }],
    expectations: [
      {
        id: "busy",
        label: "Busy threads",
        metric: { node: "caller", field: "threadsBusy" },
        op: ">",
        value: 0,
        when: "eventually",
      },
      {
        id: "waiting",
        label: "Waiting threads",
        metric: { node: "caller", field: "threadsWaiting" },
        op: ">",
        value: 0,
        when: "eventually",
      },
    ],
  });
  for (let i = 0; i < 100; i++) {
    run.step(10);
    const t = realSnapshot(run.engine.snapshot()).nodes.caller.threads!;
    expect(run.engine.measure({ node: "caller", field: "threadsBusy" })! * scale).toBeCloseTo(t.working + t.waiting);
    expect(run.engine.measure({ node: "caller", field: "threadsWaiting" })! * scale).toBeCloseTo(t.waiting);
  }
  expect(run.state().expectations.map((e) => e.status)).toEqual(["pass", "pass"]);
});

it("older revisions and nodes without waiting calls report zero thread metrics", () => {
  const d = waitingFixture();
  d.planning = { revision: "p3-a1" };
  const run = createSimulationRun(d, { id: "old", title: "Old", traffic: [] });
  for (const field of ["threadsBusy", "threadsWaiting"] as const) {
    expect(run.engine.measure({ node: "caller", field })).toBe(0);
    expect(run.engine.measure({ node: "missing", field })).toBeUndefined();
  }
});

it("native import preserves simulations with both thread expectation metrics", () => {
  const d = waitingFixture();
  d.simulations = [
    {
      id: "threads",
      title: "Threads",
      traffic: [],
      expectations: [
        { id: "busy", label: "Busy", metric: { node: "caller", field: "threadsBusy" }, op: ">=", value: 0 },
        { id: "waiting", label: "Waiting", metric: { node: "caller", field: "threadsWaiting" }, op: ">=", value: 0 },
      ],
    },
  ];
  expect(simulationProblem(d.simulations[0])).toBeUndefined();
  const imported = validateDiagram(d);
  expect(imported.ok).toBe(true);
  if (imported.ok) expect(imported.diagram.simulations).toEqual(d.simulations);
});

it("thread expectations compare real counts at scale 10", () => {
  const d = waitingFixture();
  const metric = (field: "threadsBusy" | "threadsWaiting") => ({ node: "caller", field });
  const run = createSimulationRun(d, {
    id: "threads",
    title: "Threads",
    scale: 10,
    seed: 1,
    durationMs: 1000,
    traffic: [{ id: "burst", node: "source", shape: { kind: "burst", count: 400 } }],
    expectations: [
      { id: "busy", label: "Busy", metric: metric("threadsBusy"), op: "==", value: 4, when: "eventually" },
      { id: "waiting", label: "Waiting", metric: metric("threadsWaiting"), op: "==", value: 4, when: "eventually" },
      { id: "below", label: "Below four", metric: metric("threadsBusy"), op: "<", value: 4, when: "always" },
    ],
  });
  let saturated = false;
  for (let i = 0; i < 100; i++) {
    run.step(10);
    const t = realSnapshot(run.engine.snapshot()).nodes.caller.threads!;
    const [busy, waiting] = run.state().expectations;
    // The saved expectation reads what the meter shows, in real threads, not the sampled 0.4.
    expect(busy.value).toBeCloseTo(t.working + t.waiting);
    expect(waiting.value).toBeCloseTo(t.waiting);
    saturated ||= t.working + t.waiting === 4;
  }
  expect(saturated).toBe(true);
  expect(run.state().expectations.map((e) => e.status)).toEqual(["pass", "pass", "fail"]);
});
