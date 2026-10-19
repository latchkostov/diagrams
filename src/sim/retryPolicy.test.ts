import { expect, it, vi } from "vitest";
import { retryDisposition } from "./retryPolicy";

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
