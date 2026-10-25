import { expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import nestedDeadline from "./fixtures/recovery-nested-deadline.json";
import managedJoin from "./fixtures/recovery-managed-join.json";
import { createEngine } from "./engine";
import { assertResilienceInvariants } from "./resilienceInvariants";
import { assertLedgerInvariants, assertOutcomeInvariants, type LedgerInvariantState } from "./resourceInvariants";

function drain(fixture: { diagram: unknown; scale: number; count: number }) {
  let ledger: LedgerInvariantState | undefined;
  let held = false;
  const e = createEngine({
    seed: 7,
    scale: fixture.scale,
    maxParticles: 0,
    verifyResilience(state) {
      assertResilienceInvariants(state);
      for (const edge of state.edges) held ||= edge.calls.held > 0;
    },
    verifyOutcomes: assertOutcomeInvariants,
    verifyLedger(state) {
      assertLedgerInvariants(state);
      ledger = state;
    },
  });
  e.load(fixture.diagram as DiagramFile);
  e.inject("source", fixture.count);
  e.step(500);
  expect(e.metrics().inSystem).toBeGreaterThan(0);
  const checkpoint = e.checkpoint();
  const finish = () => {
    // Finite bursts with at most three call attempts and the default broker redeliveries.
    e.step(60_000);
    expect(held).toBe(true);
    expect(e.metrics().inSystem).toBe(0);
    expect(ledger!.ledger.reservations.size).toBe(0);
    expect(ledger!.logical).toHaveLength(0);
    expect([...ledger!.admissionInFlight.values()].every((count) => count === 0)).toBe(true);
    const snapshot = e.snapshot();
    expect(snapshot.nodes.source.processed).toBe(fixture.count);
    for (const node of Object.values(snapshot.nodes)) expect(node).toMatchObject({ backlog: 0, inFlight: 0 });
    for (const edge of Object.values(snapshot.edges))
      if (edge.calls) expect(edge.calls).toMatchObject({ held: 0, inFlight: 0 });
    return snapshot;
  };
  const expected = finish();
  e.restore(checkpoint);
  expect(finish()).toEqual(expected);
}

it("drains nested deadline joins after recovery (seed 538282733)", () => {
  // Reduced to two broker messages: a nested timed-out join and its zero-work continuation.
  // Reentrant thread release used to visit that continuation twice and strand later arrivals.
  drain(nestedDeadline);
});

it("releases a fractional managed join's held calls (seed 453919836)", () => {
  // Reduced to four broker messages and a mixed blocking/non-blocking managed join.
  // The same reentrant admission reused a committed attempt and left unowned reservations.
  drain(managedJoin);
});
