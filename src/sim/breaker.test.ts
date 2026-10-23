import { expect, it } from "vitest";
import { breakerPermits, breakerRecord, breakerView, createBreaker } from "./breaker";
import { callerSchema } from "../model/admissionSchema";
import { checkJsonSchema } from "../model/jsonSchema";
import { waitingFixture } from "../lab/waitingFixture";
import { createEngine } from "./engine";
import { assertResilienceInvariants } from "./resilienceInvariants";

it("validates an empty breaker and whole-second windows, refusing unknown or invalid settings", () => {
  expect(() => checkJsonSchema({ breaker: {} }, callerSchema)).not.toThrow();
  expect(() => checkJsonSchema({ breaker: null }, callerSchema)).not.toThrow();
  for (const breaker of [{ windowMs: 1500 }, { minimumCalls: 0 }, { halfOpenCalls: 0 }, { fallback: true }])
    expect(() => checkJsonSchema({ breaker }, callerSchema)).toThrow();
});

it("counts real units, ages its window, ignores 404 and local safeguards, and lazily tests recovery", () => {
  const b = createBreaker(),
    p = { minimumCalls: 20, openMs: 1000 };
  const record = (at: number, cause: Parameters<typeof breakerRecord>[3], units = 10) => {
    const permit = breakerPermits(b, p, at, units)!;
    breakerRecord(b, p, at, cause, 30, permit);
  };
  record(0, "error");
  record(11000, "success");
  expect(b.state).toBe("closed");
  record(11000, "no-route");
  record(11000, "call-limit");
  record(11000, "breaker-open");
  expect(breakerView(b, p, 11000).calls).toBe(10);
  record(11000, "deadline");
  expect(b.state).toBe("open");
  expect(breakerPermits(b, p, 11999, 1)).toBeUndefined();
  const probe = breakerPermits(b, p, 12000, 10)!;
  expect(b.state).toBe("half-open");
  expect(breakerPermits(b, p, 12000, 10)).toBeUndefined();
  breakerRecord(b, p, 12030, "success", 30, probe);
  expect(b.state).toBe("closed");
  expect(b.buckets).toEqual([]);
});

it("reopens at the failure threshold, counts slow calls, and ignores stale probe epochs", () => {
  const b = createBreaker(),
    p = { minimumCalls: 1, slowCallMs: 20, halfOpenCalls: 2, openMs: 10 };
  breakerRecord(b, p, 20, "success", 20, breakerPermits(b, p, 0, 1)!);
  expect(b.state).toBe("open");
  const a = breakerPermits(b, p, 30, 1)!,
    c = breakerPermits(b, p, 30, 1)!;
  breakerRecord(b, p, 40, "error", 10, a);
  expect(b.state).toBe("half-open");
  breakerRecord(b, p, 40, "success", 10, c);
  expect(b.state).toBe("open");
  breakerRecord(b, p, 41, "success", 1, c);
  expect(b.state).toBe("open");
});

it("ignored or cancelled probes stay within the fixed batch and never dilute failures", () => {
  const b = createBreaker(),
    p = { minimumCalls: 1, halfOpenCalls: 3, openMs: 10 };
  breakerRecord(b, p, 0, "error", 0, breakerPermits(b, p, 0, 1)!);
  const a = breakerPermits(b, p, 10, 1)!,
    c = breakerPermits(b, p, 10, 1)!,
    d = breakerPermits(b, p, 10, 1)!;
  breakerRecord(b, p, 20, "error", 10, a);
  breakerRecord(b, p, 20, "no-route", 10, c);
  expect(b.sent).toBe(3);
  expect(breakerPermits(b, p, 20, 1)).toBeUndefined();
  breakerRecord(b, p, 20, "call-limit", 10, d);
  expect(b.state).toBe("open");
  expect(b.lastWindow).toEqual({ calls: 1, failed: 1, slow: 0 });
  expect(breakerView(b, p, 20).failurePercent).toBe(100);
  expect(b.inFlight).toBe(0);
  expect(breakerPermits(b, p, 20, 1)).toBeUndefined();
});

it("an all-ignored batch is inconclusive and waits another interval before one bounded test", () => {
  const b = createBreaker(),
    p = { minimumCalls: 1, halfOpenCalls: 1, openMs: 10 };
  breakerRecord(b, p, 0, "error", 0, breakerPermits(b, p, 0, 1)!);
  for (const time of [10, 20, 30]) {
    const permit = breakerPermits(b, p, time, 1)!;
    expect(breakerPermits(b, p, time, 1)).toBeUndefined();
    breakerRecord(b, p, time, "no-route", 0, permit);
    expect(b.state).toBe("open");
    expect(b.lastWindow).toEqual({ calls: 0, failed: 0, slow: 0 });
    expect(breakerPermits(b, p, time + 9, 1)).toBeUndefined();
  }
  breakerRecord(b, p, 40, "success", 0, breakerPermits(b, p, 40, 1)!);
  expect(b.state).toBe("closed");
});

function fixture() {
  const d = waitingFixture();
  d.planning!.revision = "p3-w2";
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = { replicas: 1, concurrency: 10, latencyMs: 30, jitter: 0, failureRate: 1 };
  d.edges[1].props = {
    travelMs: 10,
    caller: {
      deadlineMs: 200,
      poolConnections: 1,
      breaker: { minimumCalls: 1, openMs: 1000, halfOpenCalls: 2 },
      retry: { maxAttempts: 3, backoffMs: 10, strategy: "fixed", retryOn: ["transient", "timeout"] },
    },
  };
  return d;
}

it.each([1, 2, 10])(
  "short circuits pool waiters and retries at scale %i, never dispatches open, and replays probes",
  (scale) => {
    const e = createEngine({ seed: 7, scale, verifyResilience: assertResilienceInvariants });
    e.load(fixture());
    e.inject("source", 4);
    e.step(500);
    const open = e.snapshot().edges.call;
    expect(open.breaker?.state).toBe("open");
    expect(open.calls?.shortCircuited).toBeGreaterThan(0);
    expect(open.calls?.inFlight).toBe(0);
    expect(e.queuedCalls("call")).toBe(0);
    const delivered = open.delivered;
    e.inject("source", 4);
    e.step(300);
    expect(e.snapshot().edges.call.delivered).toBe(delivered);
    e.setNodeProps("partner", { failureRate: 0 });
    e.step(300);
    e.inject("source", 4);
    e.step(20);
    const cp = e.checkpoint();
    const finish = () => {
      e.step(2000);
      return e.snapshot();
    };
    const expected = finish();
    e.restore(cp);
    expect(finish()).toEqual(expected);
    expect(expected.inSystem).toBe(0);
    expect(expected.edges.call.breaker?.probesInFlight).toBe(0);
    expect(expected.events.some((v) => v.text.includes("breaker"))).toBe(true);
  },
);

it("a breaker without retries executes only in w2", () => {
  for (const revision of ["p3-w1", "p3-w2"] as const) {
    const d = fixture();
    d.planning!.revision = revision;
    delete (d.edges[1].props!.caller as import("./types").EdgeSimProps["caller"])!.retry;
    const e = createEngine({ seed: 7, verifyResilience: assertResilienceInvariants });
    e.load(d);
    e.inject("source", 4);
    e.step(1000);
    expect(e.snapshot().edges.call.breaker?.state).toBe(revision === "p3-w2" ? "open" : undefined);
    expect(e.snapshot().inSystem).toBe(0);
  }
});
