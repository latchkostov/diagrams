import { expect, it } from "vitest";
import { waitingFixture } from "../lab/waitingFixture";
import type { RetryPolicy } from "../model/admission";
import { createEngine, randomDraws } from "./engine";
import { backoffDelay, classifyOutcome, createRetryWindow, recordRetryWindow, retryWindow } from "./retryPolicy";
import { retryBudgetPermits } from "./admission";
import { realSnapshot } from "./units";
import { analyzeCapacity } from "./capacity";
import { expectedRetries } from "./retryPolicy";
import { assertResilienceInvariants } from "./resilienceInvariants";
import { assertLedgerInvariants } from "./resourceInvariants";
import { buildJourney } from "../trace/journey";
import { buildScript } from "../live/slowmo/script";
import { stencilRole } from "../stencils/roles";
import { waitingDetails } from "../live/waitingDetails";

export const naiveRetry: RetryPolicy = {
  maxAttempts: 3,
  backoffMs: 100,
  strategy: "fixed",
  retryOn: ["timeout", "transient", "throttled"],
};
export function retryFixture(policy = naiveRetry, wait: "blocking" | "non-blocking" = "blocking") {
  const d = waitingFixture();
  d.planning!.revision = "p3-w2";
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = { replicas: 1, concurrency: 100, latencyMs: 30, jitter: 0, failureRate: 1 };
  d.edges[1].props = { caller: { wait, retry: policy, deadlineMs: 200, replyMs: 20 }, travelMs: 10 };
  return d;
}

it("fixed, exponential, capped, equal and full jitter use the logical tick", () => {
  expect([1, 2, 3, 4].map((k) => backoffDelay(naiveRetry, k))).toEqual([100, 100, 100, 100]);
  const exponential = { ...naiveRetry, strategy: "exponential" as const, maxBackoffMs: 250 };
  expect([1, 2, 3, 4].map((k) => backoffDelay(exponential, k))).toEqual([100, 200, 250, 250]);
  expect(backoffDelay({ ...naiveRetry, jitter: 0.5 }, 1, 0.8)).toBe(60);
  expect(backoffDelay({ ...naiveRetry, jitter: 1 }, 1, 0.99)).toBe(10);
  expect(backoffDelay({ ...naiveRetry, backoffMs: 0 }, 1)).toBe(10);
  expect(backoffDelay({ ...exponential, maxBackoffMs: undefined }, 9)).toBe(2000);
});

it("classifies local timeouts separately from propagated 504s and never retries 404 or limits", () => {
  expect(classifyOutcome({ code: 504, timeout: true })).toBe("timeout");
  for (const code of [500, 503, 504]) expect(classifyOutcome({ code })).toBe("transient");
  expect(classifyOutcome({ code: 429 })).toBe("throttled");
  for (const outcome of [{ code: 404 }, { code: 503, local: true }, {}, { ok: true, code: 500 }])
    expect(classifyOutcome(outcome)).toBeUndefined();
});

it("the ten-second budget charges whole real cohorts, with a floor and expiring buckets", () => {
  expect(retryBudgetPermits({ percent: 20, minPerSec: 0 }, 100, 10, 10)).toBe(true);
  expect(retryBudgetPermits({ percent: 20, minPerSec: 0 }, 100, 11, 10)).toBe(false);
  expect(retryBudgetPermits({ percent: 20 }, 0, 90, 10)).toBe(true);
  const window = createRetryWindow();
  recordRetryWindow(window, 0, "requests", 100);
  recordRetryWindow(window, 9000, "retried", 20);
  expect(retryWindow(window, 9999)).toMatchObject({ requests: 100, retried: 20 });
  expect(retryWindow(window, 10000)).toMatchObject({ requests: 0, retried: 20 });
  expect(retryWindow(window, 19000).retried).toBe(0);
});

it.each(["blocking", "non-blocking"] as const)(
  "%s retries run three attempts, holding only the blocking thread through backoff",
  (wait) => {
    const e = createEngine({ seed: 7 });
    e.load(retryFixture(naiveRetry, wait));
    e.inject("source", 1);
    e.step(80);
    expect(e.snapshot().edges.call.calls).toMatchObject({
      requests: 1,
      attempts: 2,
      retried: 1,
      failed: 1,
      backingOff: 1,
      held: wait === "blocking" ? 1 : 0,
    });
    expect(e.snapshot().nodes.caller.threads!.waiting).toBe(wait === "blocking" ? 1 : 0);
    const cp = e.checkpoint();
    e.step(1000);
    const final = e.snapshot();
    expect(final.edges.call.calls).toMatchObject({
      requests: 1,
      attempts: 3,
      retried: 2,
      failed: 3,
      backingOff: 0,
      held: 0,
      inFlight: 0,
    });
    expect(final.nodes.partner.failed).toBe(3);
    expect(final.nodes.caller.failed).toBe(1);
    expect(final.inSystem).toBe(0);
    e.restore(cp);
    e.step(1000);
    expect(e.snapshot()).toEqual(final);
  },
);

it("a timed-out attempt continues, and its late reply cannot settle its retry", () => {
  const d = retryFixture({ ...naiveRetry, backoffMs: 10 });
  d.nodes[2].props = { concurrency: 100, latencyMs: 150, jitter: 0 };
  d.edges[1].props!.caller = { wait: "blocking", deadlineMs: 100, retry: { ...naiveRetry, backoffMs: 10 } };
  const e = createEngine({ seed: 1 });
  e.load(d);
  e.inject("source", 1);
  e.step(1000);
  expect(e.snapshot().edges.call.calls).toMatchObject({
    attempts: 3,
    retried: 2,
    timedOut: 3,
    late: 3,
    ambiguous: 2,
    succeeded: 0,
    inFlight: 0,
  });
  expect(e.snapshot().nodes.partner.processed).toBe(3);
  expect(e.snapshot().nodes.caller.failed).toBe(1);
});

it("each retry queues for the pool under a fresh deadline; queued timeouts are not ambiguous", () => {
  const d = retryFixture({ ...naiveRetry, backoffMs: 10 }, "non-blocking");
  d.nodes[2].props = { concurrency: 100, latencyMs: 500, jitter: 0 };
  d.edges[1].props!.caller = {
    wait: "non-blocking",
    deadlineMs: 100,
    poolConnections: 1,
    retry: { ...naiveRetry, backoffMs: 10 },
  };
  const e = createEngine({ seed: 1 });
  e.load(d);
  e.inject("source", 4);
  e.step(2000);
  expect(e.snapshot().edges.call.calls).toMatchObject({
    requests: 4,
    attempts: 12,
    retried: 8,
    timedOut: 12,
    ambiguous: 2,
    inFlight: 0,
    held: 0,
  });
  expect(e.snapshot().nodes.partner.processed).toBe(3);
  expect(e.snapshot().inSystem).toBe(0);
});

it.each([1, 2, 10])("budget caps attempts at scale %s in real units", (scale) => {
  const d = retryFixture({ ...naiveRetry, budget: { percent: 20, minPerSec: 0 } });
  const e = createEngine({ seed: 7, scale });
  e.load(d);
  e.inject("source", 100 / scale);
  e.step(10000);
  const s = realSnapshot(e.snapshot());
  expect(s.edges.call.calls!.retried).toBe(20);
  expect(s.edges.call.calls!.attempts).toBe(120);
  expect(s.edges.call.calls!.budgetDenied).toBeGreaterThan(0);
  expect(s.inSystem).toBe(0);
});

it("jitter draws never touch the global stream, and checkpoint replay retains the connection stream", () => {
  const run = (jitter: number) => {
    const e = createEngine({ seed: 17 });
    e.load(retryFixture({ ...naiveRetry, jitter }));
    e.inject("source", 4);
    e.step(80);
    const cp = e.checkpoint();
    e.step(2000);
    const s = e.snapshot();
    e.restore(cp);
    e.step(2000);
    expect(e.snapshot()).toEqual(s);
    return randomDraws(e);
  };
  expect(run(1)).toBe(run(0));
});

it("saved retries are dormant before w2", () => {
  const d = retryFixture();
  d.planning!.revision = "p3-w1";
  const e = createEngine({ seed: 7 });
  e.load(d);
  e.inject("source", 1);
  e.step(2000);
  expect(e.snapshot().nodes.partner.failed).toBe(1);
  expect(e.snapshot().edges.call.calls!.retried).toBeUndefined();
});

it.each(["requeue", "inplace"])("call retries compose with broker %s redelivery and DLQ", (retry) => {
  const d = retryFixture();
  d.nodes[0].stencil = "generic.queue";
  d.nodes[0].props = { maxDeliveryCount: 2 };
  Object.assign(d.nodes[1].props!, { retry, retryBackoffMs: 100 });
  d.nodes.push({ id: "dlq", stencil: "generic.queue", label: "Dead letters", x: 0, y: 0 });
  d.edges.push({ id: "dlq", from: "source", to: "dlq", props: { dlq: true, travelMs: 10 } });
  const e = createEngine({
    seed: 7,
    verifyResilience: assertResilienceInvariants,
    verifyLedger: assertLedgerInvariants,
  });
  e.load(d);
  e.inject("source", 1);
  e.step(5000);
  const s = e.snapshot();
  expect(s.nodes.partner.failed).toBe(6);
  expect(s.edges.call.calls).toMatchObject({ requests: 2, attempts: 6, retried: 4 });
  expect(s.nodes.source.deadLettered).toBe(1);
  expect(s.nodes.dlq.backlog).toBe(1);
});

it("a sibling failure cancels backoff and its timer without releasing a new attempt", () => {
  const d = retryFixture({ ...naiveRetry, backoffMs: 1000 });
  d.nodes.push({
    ...d.nodes[2],
    id: "sibling",
    props: { concurrency: 100, latencyMs: 100, failureRate: 1, jitter: 0 },
  });
  d.edges.push({ id: "sibling", from: "caller", to: "sibling", kind: "sync", props: { travelMs: 10 } });
  const e = createEngine({ seed: 7, verifyResilience: assertResilienceInvariants });
  e.load(d);
  e.inject("source", 1);
  e.step(3000);
  expect(e.snapshot().edges.call.calls).toMatchObject({ retried: 1, backingOff: 0, held: 0 });
  expect(e.snapshot().nodes.partner.failed).toBe(1);
  expect(e.snapshot().inSystem).toBe(0);
});

it("ten attempts is a hard cap, with a run notice and no unbounded event tail", () => {
  const e = createEngine({ seed: 7, verifyResilience: assertResilienceInvariants });
  e.load(retryFixture({ ...naiveRetry, maxAttempts: 1000, backoffMs: 0 }));
  e.inject("source", 1);
  e.step(3000);
  expect(e.snapshot().edges.call.calls).toMatchObject({ attempts: 10, retried: 9, backingOff: 0 });
  expect(e.snapshot().events.some((e) => e.text.includes("Retries capped at 10"))).toBe(true);
  expect(e.snapshot().inSystem).toBe(0);
});

it("planning amplifies callee load and blocking residence, including expected backoff and budgets", () => {
  const d = retryFixture();
  d.nodes[0].props!.ratePerSec = 10;
  const plan = analyzeCapacity(d);
  expect(plan.connections.call).toBe(30);
  expect(plan.nodes.caller.waits!.callMs).toBe(290);
  expect(expectedRetries({ ...naiveRetry, budget: { percent: 20, minPerSec: 0 } }, 1, 10)).toEqual({
    attempts: 1.2,
    backoffMs: 20,
  });
});

it("planning shares the budget floor across traffic classes using the call's aggregate rate", () => {
  const d = retryFixture({ ...naiveRetry, budget: { percent: 20, minPerSec: 10 } });
  d.nodes[0].props = { ratePerSec: 20, messageType: "First" };
  d.nodes.push({ ...d.nodes[0], id: "second", label: "Second", props: { ratePerSec: 20, messageType: "Second" } });
  d.edges.push({ ...d.edges[0], id: "second-input", from: "second" });
  const plan = analyzeCapacity(d);
  expect(plan.converged).toBe(true);
  expect(plan.connections.call).toBe(50);
  expect(plan.nodes.caller.waits!.callMs).toBe(62.5);
  expect(waitingDetails(d, {})!.nodes.get("caller")!.callMs).toBe(62.5);
});

it("planning releases pool connections during backoff while the blocking thread stays held", () => {
  const d = retryFixture();
  (d.edges[1].props!.caller as import("./types").EdgeSimProps["caller"])!.poolConnections = 10;
  const plan = analyzeCapacity(d);
  expect(plan.nodes.caller.waits!.callMs).toBe(290);
  expect(plan.nodes.caller.waits!.poolCeiling).toBeCloseTo(10000 / 90);
});

it("a successful source response separates backoff from call latency", () => {
  const d = retryFixture();
  d.edges[0].kind = "sync";
  const e = createEngine({ seed: 7 });
  e.load(d);
  e.inject("source", 1);
  e.step(80);
  e.setNodeProps("partner", { failureRate: 0 });
  e.step(1000);
  expect(e.snapshot().nodes.source.latency).toMatchObject({ backoffMs: 100 });
  expect(e.snapshot().edges.call.calls).toMatchObject({ attempts: 2, succeeded: 1 });
});

it("the trace, slow motion and log retain attempts, reasons and backoff", () => {
  const d = retryFixture();
  const e = createEngine({ seed: 7 });
  e.load(d);
  e.tracer.request({ next: "message", node: "source" });
  e.inject("source", 1);
  e.step(2000);
  const trace = e.tracer.current()!;
  expect(trace.steps.filter((s) => s.kind === "retry")).toMatchObject([
    { attempt: 2, maxAttempts: 3, backoffMs: 100, reason: "500" },
    { attempt: 3, maxAttempts: 3, backoffMs: 100, reason: "500" },
  ]);
  expect(buildJourney(trace, d).rows.filter((r) => r.backoffMs !== undefined)).toHaveLength(2);
  const script = buildScript({
    trace,
    diagram: d,
    roleOf: (id) => stencilRole(d.nodes.find((n) => n.id === id)!.stencil),
  });
  expect(script.beats.filter((b) => b.caption?.includes("backoff"))).toHaveLength(2);
  expect(
    e
      .snapshot()
      .events.filter((event) => event.kind === "retry")
      .map((event) => event.text),
  ).toEqual(
    expect.arrayContaining([
      expect.stringContaining("attempt 2/3 after 100 ms, 500"),
      expect.stringContaining("attempt 3/3 after 100 ms, 500"),
    ]),
  );
});

it("parallel branches count overlapping backoff once in response latency", () => {
  const d = retryFixture();
  d.edges[0].kind = "sync";
  d.nodes.push({ ...d.nodes[2], id: "other" });
  d.edges.push({ ...d.edges[1], id: "other-call", to: "other" });
  const e = createEngine({ seed: 7 });
  e.load(d);
  e.inject("source", 1);
  e.step(80);
  e.setNodePropsBatch({ partner: { failureRate: 0 }, other: { failureRate: 0 } });
  e.step(1000);
  expect(e.snapshot().nodes.source.latency!.backoffMs).toBe(100);
});
