import { expect, it, vi } from "vitest";
import { CheckRuns, NOTHING_TO_CHECK } from "../canvas/checks/useChecks";
import { cancelObservedWork, observationPorts, type ProductObservations } from "../lib/observations";

it("publishes completion for every Checks job, including identical findings", async () => {
  let run!: () => Promise<void>;
  const jobs = new CheckRuns(
    () => {},
    undefined,
    (task) => {
      run = task;
      return { schedule() {}, now() {}, cancel() {}, busy: () => false };
    },
  );
  const source = { documentId: "checks", identity: {} };
  const events: ProductObservations["checks"][] = [];
  const off = observationPorts.checks.subscribe((event) => events.push(event));
  jobs.setReport((status, result) => observationPorts.checks.publish({ ...source, status, result }));
  try {
    await run();
    await run();
    expect(events.map((event) => event.status)).toEqual(["running", "done", "running", "done"]);
    expect(events[1].result).toBe(NOTHING_TO_CHECK);
    expect(events[3].result).toBe(NOTHING_TO_CHECK);
  } finally {
    off();
  }
});

it.each(["cancel", "replace"] as const)("drops an in-flight Checks result after %s", async (action) => {
  let run!: () => Promise<void>;
  let resolve!: (result: typeof NOTHING_TO_CHECK) => void;
  const deliver = vi.fn();
  const report = vi.fn();
  let source = { documentId: "checks", identity: {} };
  const jobs = new CheckRuns(
    deliver,
    () => new Promise((done) => (resolve = done)),
    (task) => {
      run = task;
      return { schedule() {}, now() {}, cancel() {}, busy: () => false };
    },
  );
  jobs.setRead(() => ({
    format: "diagrams/v1",
    title: "",
    nodes: [{ id: "a", stencil: "service", label: "A", x: 0, y: 0 }],
    edges: [],
  }));
  jobs.setSource(() => source);
  jobs.setReport(report);
  const pending = run();
  if (action === "cancel") cancelObservedWork(source);
  else source = { ...source, identity: {} };
  resolve(NOTHING_TO_CHECK);
  await pending;
  expect(deliver).not.toHaveBeenCalled();
  expect(report.mock.calls.map(([status]) => status)).toEqual(["running"]);
});
