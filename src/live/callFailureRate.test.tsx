import { expect, it } from "vitest";
import fc from "fast-check";
import { renderToStaticMarkup } from "react-dom/server";
import storm from "../examples/retry-storm.json";
import type { DiagramFile } from "../model/types";
import { resilienceFixture } from "../lab/resilienceFixture";
import { createEngine } from "../sim/engine";
import { realSnapshot } from "../sim/units";
import { propertyRuns } from "../test/fastCheck";
import { callFailureRate } from "./callFailureRate";
import { LiveController } from "./controller";
import { TroubleWatcher } from "./observedTrouble";
import { CallsReadout } from "./CallsReadout";
import { BreakerReadout } from "./BreakerReadout";
import { CallOutcomes } from "./CallOutcomes";
import { requestSummary } from "./hoverSummary";
import { waitingFixture } from "../lab/waitingFixture";

it.each(["p3-w2", "p3-w1"] as const)(
  "keeps the rate unavailable after ten successes and one failure on an ordinary %s Request",
  (revision) => {
    const d = waitingFixture();
    d.planning!.revision = revision;
    const engine = createEngine({ seed: 7, scale: 1 });
    engine.load(d);
    engine.inject("caller", 10);
    for (let step = 0; step < 200; step++) engine.step(10);
    expect(engine.snapshot().nodes.partner.processed).toBe(10);
    engine.setNodeProps("partner", { failureRate: 1 });
    engine.inject("caller", 1);
    for (let step = 0; step < 200; step++) engine.step(10);
    const calls = engine.snapshot().edges.call.calls!;
    expect(calls.failed).toBe(1);
    expect(calls.succeeded).toBeUndefined();
    expect(callFailureRate(calls)).toEqual({ available: false });
    expect(renderToStaticMarkup(<CallOutcomes calls={calls} />)).toContain("—");
    expect(requestSummary(calls, undefined, false, 0).facts.find((f) => f.key === "failureRate")).toBeUndefined();
  },
);

it("distinguishes unavailable accounting from an accounted edge with zero settled attempts", () => {
  expect(callFailureRate(undefined)).toEqual({ available: false });
  expect(callFailureRate({ failed: 1 })).toEqual({ available: false });
  expect(callFailureRate({ failed: 0, succeeded: 0 })).toEqual({ available: true, failed: 0, total: 0, rate: 0 });
});

it("does not divide settled failures by a smaller population of recently started attempts", () => {
  const diagram = storm as DiagramFile;
  const controller = new LiveController(diagram);
  try {
    controller.selectSimulation(diagram.simulations![0]);
    controller.seek(60000);
    const frame = controller.getState().snapshot;
    const calls = frame.edges.pay.calls!;
    // Reproduce master's watcher window: 49 s to 60 s is eleven seconds,
    // while windowAttempts contains ten one-second buckets of starts.
    const watcher = new TroubleWatcher();
    controller.seek(49000);
    const before = controller.getState().snapshot;
    watcher.observe(before, diagram);
    for (let second = 50; second < 60; second++) {
      controller.seek(second * 1000);
      watcher.observe(controller.getState().snapshot, diagram);
    }
    const oldFraction = (calls.failed - before.edges.pay.calls!.failed) / calls.windowAttempts!;
    expect(oldFraction).toBeGreaterThan(1);
    const detail = watcher.observe(frame, diagram).find((t) => t.kind === "retry-storm")!.detail;
    const failures = callFailureRate(calls);
    if (!failures.available) throw new Error("Retry accounting must publish successes");
    expect(failures.rate).toBeLessThanOrEqual(1);
    expect(detail).toContain(`${Math.round(failures.rate * 100)}%`);
    expect(detail).toContain("settled attempts failed since restart");
    expect(detail).not.toMatch(/1\d\d%/);
    const html = renderToStaticMarkup(<CallsReadout diagram={diagram} node="checkout" snapshot={frame} />);
    expect(html).toContain(`${Math.round(failures.rate * 100)}%`);
    expect(renderToStaticMarkup(<CallOutcomes calls={calls} />)).toContain(`${Math.round(failures.rate * 100)}%`);
  } finally {
    controller.dispose();
  }
});

it("uses the identical settled population in the breaker readout, excluding local rejections", () => {
  const calls = { inFlight: 0, held: 0, timedOut: 20, failed: 120, late: 0, shortCircuited: 100, succeeded: 80 };
  const breaker = {
    state: "open" as const,
    remainingMs: 1000,
    calls: 20,
    failurePercent: 100,
    probesSent: 0,
    probesSettled: 0,
    probesInFlight: 0,
    probes: 5,
  };
  expect(callFailureRate(calls)).toEqual({ available: true, failed: 20, total: 100, rate: 0.2 });
  const html = renderToStaticMarkup(<BreakerReadout id="call" breaker={breaker} calls={calls} testId="breaker" />);
  expect(html).toContain("20%");
  expect(html).toContain("100 settled attempts failed since restart");
  const diagram = waitingFixture();
  const engine = createEngine({ seed: 7, scale: 1 });
  engine.load(diagram);
  const snapshot = realSnapshot(engine.snapshot());
  snapshot.edges.call.calls = { ...calls, requests: 100, attempts: 200 };
  const docked = renderToStaticMarkup(<CallsReadout docked diagram={diagram} node="caller" snapshot={snapshot} />);
  expect(docked).toContain('<dt>Failing</dt><dd class="mono">\u206820%\u2069</dd>');
});

it("keeps the failure rate in [0, 1] over random retries, breakers, delays and recovery", () => {
  fc.assert(
    fc.property(
      fc.record({
        attempts: fc.integer({ min: 1, max: 10 }),
        backoff: fc.integer({ min: 0, max: 200 }),
        minimum: fc.integer({ min: 1, max: 20 }),
        failure: fc.constantFrom(0, 0.3, 1),
        breaker: fc.boolean(),
        budget: fc.boolean(),
        scale: fc.constantFrom(1, 2, 10),
      }),
      (config) => {
        const d = resilienceFixture();
        d.nodes[2].props!.failureRate = config.failure;
        d.edges[1].props!.caller = {
          wait: "non-blocking",
          deadlineMs: 100,
          retry: {
            maxAttempts: config.attempts,
            backoffMs: config.backoff,
            strategy: "exponential",
            jitter: 1,
            retryOn: ["timeout", "transient", "throttled"],
            ...(config.budget ? { budget: { percent: 20 } } : {}),
          },
          ...(config.breaker ? { breaker: { minimumCalls: config.minimum, openMs: 200 } } : {}),
        };
        const engine = createEngine({ seed: 7, scale: config.scale });
        engine.load(d);
        engine.setTraffic(true);
        for (let step = 0; step < 30; step++) {
          if (step === 15) engine.setNodeProps("partner", { failureRate: 0 });
          engine.step(100);
          const calls = realSnapshot(engine.snapshot()).edges.call.calls!;
          const failures = callFailureRate(calls);
          if (!failures.available) throw new Error("Retry accounting must publish successes");
          const { failed, total, rate } = failures;
          expect(failed).toBeGreaterThanOrEqual(0);
          expect(total).toBeGreaterThanOrEqual(failed);
          expect(rate).toBeGreaterThanOrEqual(0);
          expect(rate).toBeLessThanOrEqual(1);
        }
      },
    ),
    { numRuns: propertyRuns(50) },
  );
});
