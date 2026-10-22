import { expect, it } from "vitest";
import { waitingFixture } from "../lab/waitingFixture";
import { upgradeResilience, resilienceUpgradeCalls, legacyExport } from "./migration";
import { validateDiagram } from "../interop/native";
import { recommendedRetry } from "../sim/resiliencePresets";

it("upgrades saved retries explicitly, preserving their details and the previous document", () => {
  const d = waitingFixture();
  const retry = recommendedRetry("POST");
  d.edges[1].props!.caller = { retry };
  d.simulations = [{ id: "saved", title: "Saved", traffic: [], setup: { edges: { call: { caller: { retry } } } } }];
  const before = structuredClone(d);
  expect(resilienceUpgradeCalls(d)).toMatchObject([
    { edge: "call", attempts: 3 },
    { edge: "call", attempts: 3, simulation: "Saved" },
  ]);
  const next = upgradeResilience(d);
  expect(next.planning!.revision).toBe("p3-w2");
  expect(validateDiagram(next).ok).toBe(true);
  expect(next.edges[1].props!.caller).toEqual({ retry });
  const off = upgradeResilience(d, true);
  expect(off.edges[1].props!.caller).toEqual({ retry: { ...retry, maxAttempts: 1 } });
  expect(off.simulations![0].setup!.edges!.call.caller!.retry).toEqual({ ...retry, maxAttempts: 1 });
  expect(d).toEqual(before);
  expect(legacyExport(next).losses).toContain("retries, circuit breakers and queue limits stop running");
});

it("validates retry caps and budgets, rejecting invalid ranges and unknown fields", () => {
  for (const patch of [
    { maxBackoffMs: -1 },
    { budget: { percent: 0 } },
    { budget: { percent: 101 } },
    { budget: { percent: 20, minPerSec: 10001 } },
    { budget: { percent: 20, unknown: 1 } },
  ]) {
    const d = upgradeResilience(waitingFixture());
    d.edges[1].props!.caller = { retry: { ...recommendedRetry("GET"), ...patch } };
    expect(validateDiagram(d).ok).toBe(false);
  }
  expect(recommendedRetry("GET").retryOn).toEqual(["throttled", "transient", "timeout"]);
  expect(recommendedRetry("POST").retryOn).toEqual(["throttled"]);
  expect(recommendedRetry().retryOn).toEqual(["throttled"]);
});
