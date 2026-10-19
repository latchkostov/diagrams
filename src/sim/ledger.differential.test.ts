import { expect, it } from "vitest";
import master from "../../tests/fixtures/ledger-master-traces.json";
import { ledgerTrace, ledgerTraceCases } from "../test/ledgerTrace";
import { createEngine } from "./engine";

// Recorded by running these same cases with engine.ts from this exact origin/master commit.
// Deliberately separate from output parity: never re-record these to accommodate a ledger change.
it.each(ledgerTraceCases)("matches master through final completion: $name", (scenario) => {
  expect(master.master).toBe("1b72a891d57850743420283d4565d9e968b3405f");
  const actual = ledgerTrace(createEngine, scenario);
  const baseline = master.traces[scenario.name as keyof typeof master.traces];
  if (scenario.scale === 1) expect(actual).toEqual(baseline);
  // R2 intentionally answers sampled calls before their holds end. Preserve the
  // final delivery/outcome totals and require both traces to reach completion.
  expect(actual.at(-1)!.slice(1)).toEqual(baseline.at(-1)!.slice(1));
  expect(actual.at(-1)![3]).toBe(0);
  expect(baseline.at(-1)![3]).toBe(0);
});
