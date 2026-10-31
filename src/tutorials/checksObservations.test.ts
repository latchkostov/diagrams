import { expect, it } from "vitest";
import { CheckRuns, NOTHING_TO_CHECK } from "../canvas/checks/useChecks";
import { observationPorts, type ProductObservations } from "../lib/observations";

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
