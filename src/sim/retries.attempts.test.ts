import { expect, it } from "vitest";
import type { RetryPolicy } from "../model/admission";
import type { DiagramFile } from "../model/types";
import { resourceLesson } from "../model/autoscaling";
import { waitingFixture } from "../lab/waitingFixture";
import { createEngine } from "./engine";
import { assertResilienceInvariants } from "./resilienceInvariants";
import { assertLedgerInvariants, assertOutcomeInvariants } from "./resourceInvariants";
import { realSnapshot } from "./units";

/**
 * Classification belongs to each logical attempt: a join, its continuation and every retry are
 * separate attempts, so a successful join never colours the reply of a continuation that failed.
 */

const transientOnly: RetryPolicy = { maxAttempts: 3, backoffMs: 100, strategy: "fixed", retryOn: ["transient"] };

/** Source -(retried Request)-> Caller -(non-blocking, 200 ms continuation)-> Side. */
function continuationChain(policy: RetryPolicy = transientOnly): DiagramFile {
  const d = waitingFixture();
  d.planning!.revision = "p3-w2";
  d.nodes[1].props = {
    replicas: 2,
    concurrency: 1,
    latencyMs: 0,
    jitter: 0,
    resources: {
      ...resourceLesson(),
      cpuMsPerMessage: 51,
      terminationGraceMs: 100,
      startup: { delayMs: 0, jitterFraction: 0 },
    },
  };
  d.nodes[2] = { ...d.nodes[2], id: "side", props: { api: { latencyMs: 20, errorRate: 0 }, jitter: 0 } };
  d.edges = [
    { id: "input", from: "source", to: "caller", kind: "sync", props: { travelMs: 10, caller: { retry: policy } } },
    {
      id: "side-call",
      from: "caller",
      to: "side",
      kind: "sync",
      props: { travelMs: 10, caller: { wait: "non-blocking", replyMs: 200 } },
    },
  ];
  return d;
}

function engine(scale: number, outcomes?: Map<number, { ok: boolean; cause?: string }>) {
  return createEngine({
    seed: 19,
    scale,
    maxParticles: 0,
    verifyResilience: assertResilienceInvariants,
    verifyLedger: assertLedgerInvariants,
    verifyOutcomes(s) {
      assertOutcomeInvariants(s);
      if (outcomes) for (const a of s.attempts) if (a.node === "caller" && a.outcome) outcomes.set(a.id, a.outcome);
    },
  });
}

const retryReasons = (e: ReturnType<typeof createEngine>) =>
  e
    .snapshot()
    .events.filter((event) => event.kind === "retry")
    .map((event) => /after \d+ ms, (\w+)/.exec(event.text)?.[1]);

it.each([
  { scale: 1, requests: 2, shrinkAt: 100 },
  { scale: 10, requests: 1, shrinkAt: 60 },
])(
  "a continuation terminated by drain grace after a successful join retries upstream as transient (scale $scale)",
  ({ scale, requests, shrinkAt }) => {
    const outcomes = new Map<number, { ok: boolean; cause?: string }>();
    const e = engine(scale, outcomes);
    e.load(continuationChain());
    e.inject("source", requests);
    e.step(shrinkAt);
    // Shrink while a continuation runs: its replica drains and the 100 ms grace terminates it.
    e.setNodeProps("caller", { replicas: 1 });
    e.step(4000);
    expect(retryReasons(e)).toEqual(["500"]);
    const s = e.snapshot();
    expect(s.edges.input.calls).toMatchObject({ requests, attempts: requests + 1, retried: 1, failed: 1 });
    expect(s.edges.input.calls).toMatchObject({ succeeded: requests });
    // Every join succeeded; only the terminated continuation failed, with its own cause.
    const causes = [...outcomes.values()].map((o) => o.cause);
    expect(causes.filter((c) => c !== "success")).toEqual(["error"]);
    expect(causes).toHaveLength(2 * (requests + 1));
    expect(s.inSystem).toBe(0);
  },
);

it.each([1, 10])("paused successful join followed by outage retries upstream (scale %s)", (scale) => {
  const d = continuationChain({ ...transientOnly, backoffMs: 500 });
  d.nodes[1].props = { replicas: 1, concurrency: 4, latencyMs: 10, jitter: 0 };
  d.edges[1].props!.caller = { wait: "non-blocking", replyMs: 1000 };
  const outcomes = new Map<number, { ok: boolean; cause?: string }>();
  const e = engine(scale, outcomes);
  e.load(d);
  e.inject("source", 1);
  e.step(30);
  e.setNodeStatus("caller", "paused");
  e.step(300);
  // The join succeeded while paused; the continuation has not run.
  expect([...outcomes.values()].map((o) => o.ok)).toEqual([true]);
  e.setNodeStatus("caller", "down");
  e.step(100);
  expect(retryReasons(e)).toEqual(["503"]);
  expect([...outcomes.values()].map(({ ok, cause }) => ({ ok, cause }))).toEqual([
    { ok: true, cause: "success" },
    { ok: false, cause: "callee-down" },
  ]);
  // Restored during the 500 ms backoff: the retry is served.
  e.setNodeStatus("caller", "up");
  e.step(3000);
  const s = realSnapshot(e.snapshot());
  expect(s.edges.input.calls).toMatchObject({ attempts: 2 * scale, retried: scale, succeeded: scale, failed: scale });
  expect(s.nodes.caller.failed).toBe(scale);
  expect(s.inSystem).toBe(0);
});

it.each([
  { retryOn: ["transient"], attempts: 3 },
  { retryOn: ["throttled", "timeout"], attempts: 1 },
] as const)(
  "a continuation after a failed join carries the join's class upstream ($retryOn)",
  ({ retryOn, attempts }) => {
    const d = continuationChain({ ...transientOnly, retryOn: [...retryOn] });
    d.nodes[1].props = { replicas: 1, concurrency: 4, latencyMs: 10, jitter: 0 };
    d.nodes[2].props = { api: { latencyMs: 20, errorRate: 1 }, jitter: 0 };
    const outcomes = new Map<number, { ok: boolean; cause?: string }>();
    const e = engine(1, outcomes);
    e.load(d);
    e.inject("source", 1);
    e.step(3000);
    expect(e.snapshot().edges.input.calls).toMatchObject({ attempts, retried: attempts - 1, failed: attempts });
    // Each attempt is a failed join, then its continuation replying with the join's inherited cause.
    expect([...outcomes.values()].map((o) => o.cause)).toEqual(Array(2 * attempts).fill("error"));
    expect(e.snapshot().inSystem).toBe(0);
  },
);

it.each([1, 10])(
  "an outage during a running continuation after a successful join retries upstream (scale %s)",
  (scale) => {
    const d = continuationChain({ ...transientOnly, backoffMs: 500 });
    d.nodes[1].props = { replicas: 1, concurrency: 4, latencyMs: 10, jitter: 0 };
    const outcomes = new Map<number, { ok: boolean; cause?: string }>();
    const e = engine(scale, outcomes);
    e.load(d);
    e.inject("source", 1);
    e.step(150);
    e.setNodeStatus("caller", "down");
    e.step(100);
    e.setNodeStatus("caller", "up");
    e.step(3000);
    expect(retryReasons(e)).toEqual(["503"]);
    expect(e.snapshot().edges.input.calls).toMatchObject({ attempts: 2, retried: 1, succeeded: 1, failed: 1 });
    expect([...outcomes.values()].map((o) => o.cause)).toEqual(["success", "callee-down", "success", "success"]);
    expect(e.snapshot().inSystem).toBe(0);
  },
);

it("a Request blocked by a deny rule is terminal upstream, as a missing route is", () => {
  const d = continuationChain({ ...transientOnly, retryOn: ["transient", "throttled", "timeout"] });
  d.nodes[1].props = { replicas: 1, concurrency: 4, latencyMs: 10, jitter: 0 };
  d.edges[1].props = { ...d.edges[1].props, deny: true };
  const e = engine(1);
  e.load(d);
  e.inject("source", 1);
  e.step(3000);
  expect(e.snapshot().edges.input.calls).toMatchObject({ attempts: 1, retried: 0, failed: 1 });
  expect(e.snapshot().nodes.caller.blocked).toBe(1);
  expect(e.snapshot().inSystem).toBe(0);
});
