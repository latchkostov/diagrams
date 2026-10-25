import { expect, it } from "vitest";
import type { DiagramFile, MetricField } from "../model/types";
import storm from "../examples/retry-storm.json";
import { createSimulationRun } from "./simulation";
import { realSnapshot } from "./units";

it.each([1, 2, 10])(
  "the five resilience expectation metrics use real units at scale %i, with idle amplification one",
  (scale) => {
    const d = structuredClone(storm) as DiagramFile;
    d.edges.find((e) => e.id === "pay")!.props!.caller = {
      deadlineMs: 30,
      retry: { maxAttempts: 3, strategy: "fixed", backoffMs: 0, retryOn: ["throttled", "timeout"] },
      breaker: { minimumCalls: 1, failurePercent: 1, openMs: 500 },
    };
    d.nodes.find((n) => n.id === "payments")!.props = {
      ...d.nodes.find((n) => n.id === "payments")!.props,
      concurrency: 1,
      replicas: 1,
      latencyMs: 200,
      queue: { limit: 1 },
    };
    const fields: { node: string; field: MetricField }[] = [
      { node: "checkout", field: "retried" },
      { node: "checkout", field: "amplification" },
      { node: "checkout", field: "shortCircuited" },
      { node: "payments", field: "shed" },
      { node: "shop", field: "goodput" },
    ];
    const run = createSimulationRun(d, {
      id: "metrics",
      title: "Metrics",
      durationMs: 3000,
      scale,
      traffic: [],
      expectations: fields.map((metric, i) => ({ id: String(i), label: metric.field, metric, op: ">=", value: 0 })),
    });
    expect(run.engine.measure({ node: "checkout", field: "amplification" })).toBe(1);
    run.engine.setTraffic(true);
    run.step(3000);
    const snapshot = realSnapshot(run.engine.snapshot()),
      calls = snapshot.edges.pay.calls!;
    expect(calls.shortCircuited).toBeGreaterThan(0);
    expect(snapshot.nodes.payments.shed).toBeGreaterThan(0);
    const expected = [
      calls.retried ?? 0,
      calls.windowRequests ? calls.windowAttempts! / calls.windowRequests : 1,
      calls.shortCircuited ?? 0,
      snapshot.nodes.payments.shed ?? 0,
      snapshot.nodes.shop.throughput,
    ];
    expect(run.state().expectations.map((e) => e.value)).toEqual(expected);
  },
);
