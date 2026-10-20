import type { LedgerInvariantState } from "../sim/resourceInvariants";
import type { SimEngine } from "../sim/types";
import { STEP } from "../sim/timing";

/** Logical work is bounded separately from already-retired capacity's exact release clocks. */
export function drainRetiredLedger(engine: SimEngine, state: LedgerInvariantState): void {
  if (engine.metrics().inSystem) return;
  const reservations = [...state.ledger.reservations.values()];
  if (!reservations.length) return;
  // Never turn an orphaned live reservation into an unbounded drain allowance.
  if (reservations.some((r) => r.releaseAt === undefined || !Number.isFinite(r.releaseAt))) return;
  const clocks = new Map([...state.nodes].map((n) => [n.id, n.activeMs]));
  const remaining = Math.max(
    0,
    ...reservations.map((r) => r.releaseAt! + (r.admissionLagMs ?? 0) - clocks.get(r.owner)!),
  );
  engine.step(remaining + STEP);
}
