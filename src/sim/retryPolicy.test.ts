import { expect, it, vi } from "vitest";
import { classifyOutcome, retryDisposition, type ClassifiedOutcome, type OutcomeKind } from "./retryPolicy";

// Record makes a newly added terminal cause a compile-time failure until its semantics are asserted here.
const terminalCases = {
  success: [undefined, undefined, "success"],
  error: ["transient", 500, "failure"],
  "callee-down": ["transient", 503, "failure"],
  "upstream-timeout": ["transient", 504, "failure"],
  shed: ["throttled", 503, "failure"],
  quota: ["throttled", 429, "failure"],
  deadline: ["timeout", 504, "slow"],
  "no-route": [undefined, 404, "ignored"],
  "breaker-open": [undefined, 503, "not-recorded"],
  "call-limit": [undefined, undefined, "ignored"],
  "invalid-admission": [undefined, undefined, "ignored"],
} satisfies Record<
  OutcomeKind,
  [ClassifiedOutcome["class"], ClassifiedOutcome["code"], ClassifiedOutcome["breakerCounts"]]
>;

it.each(Object.entries(terminalCases))("classifies the terminal %s path", (kind, [retryClass, code, breakerCounts]) => {
  expect(classifyOutcome(kind as OutcomeKind)).toEqual({ kind, class: retryClass, code, breakerCounts });
});

it.each([
  { delivery: false, inplace: true, attempts: 0, maxDeliveryCount: 2, retain: true, expected: "none" },
  { delivery: true, inplace: true, attempts: 0, maxDeliveryCount: 2, retain: true, expected: "inplace" },
  { delivery: true, inplace: true, attempts: 1, maxDeliveryCount: 2, retain: true, expected: "broker" },
  { delivery: true, inplace: false, attempts: 0, maxDeliveryCount: 2, retain: true, expected: "broker" },
  { delivery: true, inplace: true, attempts: 0, maxDeliveryCount: 2, retain: false, expected: "broker" },
])("chooses $expected before failure counters and ownership change", ({ expected, ...state }) => {
  const retain = vi.fn(() => state.retain);
  expect(retryDisposition({ ...state, retain })).toBe(expected);
  expect(retain).toHaveBeenCalledTimes(
    state.delivery && state.inplace && state.attempts + 1 < state.maxDeliveryCount ? 1 : 0,
  );
});
