import { expect, it } from "vitest";
import master from "../../tests/fixtures/ledger-master-traces.json";
import divisible from "../../tests/fixtures/ledger-master-divisible-traces.json";
import timing from "../../tests/fixtures/ledger-r2-timing.json";
import { divisibleTimingCases, ledgerTrace, ledgerTraceCases } from "../test/ledgerTrace";
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

it.each(ledgerTraceCases.filter((s) => s.scale > 1))(
  "sampled calls preserve expected delivery and pause/resume timing: $name",
  (scenario) => {
    const actual = ledgerTrace(createEngine, scenario);
    const checkpoints = timing[scenario.name as keyof typeof timing] as [
      number,
      ReturnType<typeof ledgerTrace>[number],
    ][];
    for (const [at, state] of checkpoints) {
      expect(actual.filter((entry) => entry[0] <= at).at(-1)).toEqual(state);
    }
    // The final recorded state is completion, even for a query after completion.
    expect(actual.at(-1)).toEqual(checkpoints.at(-1)![1]);
  },
);

it.each(divisibleTimingCases)("divisible sampled pools preserve master's complete timing: $name", (scenario) => {
  expect(divisible.master).toBe(master.master);
  expect(ledgerTrace(createEngine, scenario)).toEqual(divisible.traces[scenario.name as keyof typeof divisible.traces]);
});
