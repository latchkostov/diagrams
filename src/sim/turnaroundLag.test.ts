import { afterEach, expect, it, vi } from "vitest";
import { waitingFixture } from "../lab/waitingFixture";
import { resourceLesson } from "../model/autoscalingLessons";
import { createEngine } from "./engine";
import { SampledLedger } from "./ledger";
import { STEP } from "./timing";

afterEach(() => vi.restoreAllMocks());

it.each(["incoming", "after-loop", "arrival-resource", "fleet"] as const)(
  "records turnaround lag in %s phase",
  (phase) => {
    const d = waitingFixture();
    d.nodes[1].props = { concurrency: 1, replicas: 1, latencyMs: 1, jitter: 0 };
    d.nodes[2].stencil = "generic.service";
    d.nodes[2].props = { concurrency: 1, replicas: 1, latencyMs: 1, jitter: 0 };
    d.edges[1].props = { networkDelayMs: 10, caller: { wait: "blocking", replyMs: 0 } };
    if (phase !== "incoming")
      d.nodes[2].props.resources = {
        ...resourceLesson(),
        cpuMsPerMessage: 0,
        startup: { delayMs: 0, jitterFraction: 0 },
      };
    if (phase === "arrival-resource") {
      d.nodes[1].stencil = "aws.lambda";
      d.nodes[1].props = { ...d.nodes[1].props, scaling: "fixed", maxConcurrency: 1, api: { latencyMs: 10 } };
    }
    if (phase === "fleet")
      d.nodes[1].props.resources = {
        ...resourceLesson(),
        cpuMsPerMessage: 0,
        startup: { delayMs: 0, jitterFraction: 0 },
      };
    const retire = vi.spyOn(SampledLedger.prototype, "retire");
    const e = createEngine({ scale: 2, seed: 7, maxParticles: 0 });
    e.load(d);
    e.inject("source", 1);
    e.step(STEP);
    const checkpoint = e.checkpoint();
    e.step(500);
    const calls = retire.mock.calls.filter(([r]) => r.owner === "caller" && r.scope === "thread" && r.phase === "wait");
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toBeGreaterThan(0);
    expect(calls[0][0].admissionLagMs).toBe(phase === "after-loop" ? STEP : 0);
    const expected = e.snapshot();
    e.step(STEP);
    e.restore(checkpoint);
    e.step(500);
    expect(e.snapshot()).toEqual(expected);
    e.reset();
    e.inject("source", 1);
    e.step(STEP + 500);
    expect(e.snapshot()).toEqual(expected);
  },
);

/** A one-slot Lambda caller with zero-time work, blocking on a zero-time service. */
function admitOnArrival(viaCaller: boolean) {
  const d = waitingFixture();
  d.nodes[1].stencil = "aws.lambda";
  d.nodes[1].props = {
    concurrency: 1,
    replicas: 1,
    latencyMs: 0,
    jitter: 0,
    scaling: "fixed",
    maxConcurrency: 1,
    api: { latencyMs: 0 },
  };
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = { concurrency: 1, replicas: 1, latencyMs: 0, jitter: 0 };
  d.edges[1].props = { networkDelayMs: 0, caller: { wait: "blocking", replyMs: 0 } };
  if (viaCaller) {
    // A front service calls the Lambda: a dot its caller awaits is not split, so the Lambda holds it in waves.
    d.nodes.push({ ...d.nodes[2], id: "front", props: { concurrency: 2, replicas: 1, latencyMs: 0, jitter: 0 } });
    d.edges.push({
      id: "front-call",
      from: "front",
      to: "caller",
      kind: "sync",
      props: { networkDelayMs: 0, caller: { wait: "blocking", replyMs: 0 } },
    });
  }
  const retire = vi.spyOn(SampledLedger.prototype, "retire");
  const e = createEngine({ scale: 2, seed: 7, maxParticles: 0 });
  e.load(d);
  e.inject(viaCaller ? "front" : "source", 1);
  e.step(5 * STEP);
  const calls = retire.mock.calls.filter(([r]) => r.owner === "caller" && r.scope === "thread" && r.phase === "wait");
  expect(calls).toHaveLength(1);
  return calls[0][0];
}

it("an admit-on-arrival caller waits only for its cohort's inner turnarounds", () => {
  const thread = admitOnArrival(true);
  // Ordinary-clock arrivals admit before the tick's due releases. Of the two requests
  // held at weight one, only the turnaround between them waits for the next phase.
  expect([thread.weight, thread.represented, thread.heldMs]).toEqual([1, 2, STEP]);
  expect(thread.admissionLagMs).toBe(STEP / 2);
  // Scale one admits the second request a tick after the first settles and frees the
  // slot for the next arrival phase: released by the preceding due-release phase.
  expect(thread.releaseAt! + thread.admissionLagMs!).toBe(thread.startActive + 2 * (STEP + STEP) - STEP);
});

it("a throttle split leaves an admit-on-arrival cohort no inner turnaround", () => {
  // Sampling 8a: the one slot admits one request of the dot and refuses the other, as scale 1 does, so the
  // admitted request holds its full weight and frees the slot in its own phase.
  const thread = admitOnArrival(false);
  expect([thread.weight, thread.represented, thread.heldMs]).toEqual([1, 1, STEP]);
  expect(thread.admissionLagMs).toBe(0);
  expect(thread.releaseAt! + thread.admissionLagMs!).toBe(thread.startActive + STEP);
});
