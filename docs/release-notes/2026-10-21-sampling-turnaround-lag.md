## Sampling accuracy: turnaround follows the tick phase

Sampled blocking callers now stretch the admission delay only when their node has no admission
opportunity left in the tick. Per-node and incoming phase stamps replace the fleet/zero-local-work
heuristic; reset and checkpoint replay preserve the phase state. Request and pool retirement,
settlement ordering and release quantization retain their existing behavior.

The sub-tick local-work gap closes at scales 1.5, 2, 3 and 4. Lambda joins of ordinary and fleet
replies pass at 2 and 4. Managed admission remains an expected failure, with improved exact pins:
scale 1.01 changes from 335.32 to 399.96 real caller completions (same-arrivals scale one: 662);
scale 2.5 changes from 400 to 500 (reference: 599). Every remaining expected-failure sibling pins
all compared node outcomes and downstream timeout/late counts. The fixed 40-sample I1 corpus has
an explicit hang backstop and retains 13/31 passing scale-greater-than-one samples.

Output parity checks all 2,897 goldens unchanged across Node and browser tiers; none was re-recorded. No tolerances or bundle budgets are raised. Restoring the old implementation makes all six closed
I1 cases and both zero-lag phase regressions fail; restoring the fix passes them.
