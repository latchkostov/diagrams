## R3 admission counterexamples

Fixed two playback failures without changing the R3 ownership model. A live request-cap reduction now
uses the same effective execution ceiling for admission and thread reservations, including threads
whose request leases predate the new cap. Starting a request admitted while paused preserves its
original represented weight across a live scale change.

Two-node regressions describe each command sequence without fast-check. Temporarily reverting the
fixes makes both fail with the original crash or lease-occupancy mismatch. The second case shrank
from fresh seed 1839831286 and reproduces the reported class of occupancy failure.

The shared-allocation backoff property retains its generated diagrams, scales, caps, outage durations,
down/up boundary, deterministic comparison, recovery counts and complete lease cleanup. Its sibling
only needs a 20 ms simulated service horizon to occupy the next recovery tick, rather than 2 seconds.
An extra assertion proves the sibling is still executing at that boundary.
On Node 24.22.0 with seed -2104931721, 40 runs took 2.095 s before and 0.459 s after.

The allocator remains in admission.ts; recovery still uses reacquire, with one admission path per work
item. Rejected approaches: suppressing the crash, relaxing the oracle, changing the generators, or
raising the timeout would hide incorrect ownership rather than repair it.

Fresh seed 1007768314 also exposed a test-harness cutoff: nested off-thread replies with CPU-backed
work can leave valid retired request residence beyond 200 seconds. Its fixed regression pins the
last release at 202,310 ms. The harness retains the 200-second logical-work bound, then advances only
already-retired finite reservations to their recorded owner-clock deadlines. Live/orphaned leases
still fail the unchanged idle assertions. Removing that exact-clock cleanup fails the regression.

No new simulation, planning or stencil feature is added, so no showcase example is needed. No parity
golden changes are intended or recorded; the skill viewer is refreshed through pnpm regen.

## Seed sweep

All 21 seeds passed with FC_RUN_MULTIPLIER=5: ledger.commands.test.ts and every waits*.test.ts in
src/sim and src/planning (167 tests per seed; 3,507 passing test executions).
The original seed and twenty distinct fresh seeds:

-2104931721, 1839831286, -1430254547, -214122128, -1624292605, 464769438, -374479577, 76490646, 1007768314, -1592463738, 1700510540, -888669744, 1536388165, 1838441780, -1124014300, 435203875, -1569170428, 1831151420, 693945068, 1890906136, -745012899

## Validation

Node 24.22.0. The full unit run passed 12,775 tests with four skipped; the additional exact-clock
regression passed separately. Full parity passed all 2,712 goldens unchanged, including 93 browser
tests. Production build, entry/viewer bundle budgets, regenerated skill freshness and i18n validation
passed. Both engine regressions and the exact-clock cleanup were checked by temporarily removing
their fixes and observing their original failures.
