import { expect, it } from "vitest";
import master from "../../tests/fixtures/ledger-master-traces.json";
import { ledgerTrace, ledgerTraceCases } from "../test/ledgerTrace";
import { createEngine } from "./engine";

// Recorded by running these same cases with engine.ts from this exact origin/master commit.
// Deliberately separate from output parity: never re-record these to accommodate a ledger change.
it.each(ledgerTraceCases)("matches master delivery and completion timing: $name", (scenario) => {
  expect(master.master).toBe("354b5dd0b12771d1fc4c16a51285ea810cbf55a4");
  expect(ledgerTrace(createEngine, scenario)).toEqual(master.traces[scenario.name as keyof typeof master.traces]);
});
