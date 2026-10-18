import { expect, it } from "vitest";
import { state } from "../i18n/core";
import type { Fault } from "./faults";
import { nodeFaultLabel, nodeFaultLabels } from "./faultWords";

it("indexes 10,000 fault steps once for 5,000 node labels and invalidates on locale change", () => {
  let reads = 0;
  const faults: Fault[] = Array.from({ length: 10_000 }, (_, i) => ({
    ...(i < 5000 ? { kind: "slow" as const, factor: 5 as const } : { kind: "fail" as const, rate: 0.5 as const }),
    get node() {
      reads++;
      return `n${i % 5000}`;
    },
  }));
  const labels = nodeFaultLabels(faults);
  for (let i = 0; i < 5000; i++) expect(nodeFaultLabel(`n${i}`, faults)).toBe("5× slower · fails 50%");
  expect(reads).toBeLessThanOrEqual(3 * faults.length);
  reads = 0;
  expect(nodeFaultLabels(faults)).toBe(labels);
  expect(reads).toBe(0);
  const locale = state.l;
  try {
    state.l = "en-XA";
    expect(nodeFaultLabels(faults)).not.toBe(labels);
    expect(reads).toBeGreaterThan(0);
  } finally {
    state.l = locale;
  }
  expect(nodeFaultLabels([{ kind: "slow", node: "n0", factor: 1 }]).size).toBe(0);
});
