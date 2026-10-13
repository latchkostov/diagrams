// Run simulations' bounds (src/checks/evidence.ts), on their own so the client can read them without loading the engine.

export const EVIDENCE_LIMITS = {
  /** Simulated time each simulation plays, at most. */
  simulatedMs: 60_000,
  /** Wall-clock time for all of them; simulations not finished within it aren't counted. */
  wallMs: 15_000,
  /** Engine ticks between looks at the clock (and between slices a caller may yield at). */
  sliceTicks: 100,
  /**
   * The most work a simulation may start: the messages its traffic and timeline inject (sampled), times the most
   * routes a node sends a copy down. A file at the format's limits (200,000 messages) with an ordinary fan-out is far
   * under it; a burst of 100,000 into 20,000 routes is not.
   */
  startWork: 10_000_000,
} as const;
