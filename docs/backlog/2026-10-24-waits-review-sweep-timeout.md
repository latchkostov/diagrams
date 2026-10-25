## Existing pool-property backstop at multiplier 20 (2026-10-24)

The resilience PR 4 engine merge sweep ran on Node 24.22.0 with `CI=true`, 40 fresh seeds at ×5
and four at ×20, eight budgeted jobs. Its exact result was:

`SUMMARY: 40 passed, 4 failed, 0 unrun; 1854.91s`

There were no counterexamples. All four ×20 runs passed the resilience-invariant file and the other
engine files except `src/sim/waits.review.test.ts`. They crossed its existing 40-second CI hang
backstop in `sampled callers preserve non-divisible pool capacity: generated scales for 1 slots`;
three also crossed it for two slots. Failed seeds: `-1353972177`, `2092662136`, `537876885`,
`-715954914`. No timeout, assertion or property run count was changed.

The exact one-slot case at seed `-1353972177`, `FC_RUN_MULTIPLIER=20`, was then run twice on a
clean archive of origin/master `8e58be7e421cd6b812d85ec0182a13244d59e8de`: one passed and one
reproduced the identical 40-second timeout (52.54 s total). The later tutorial master `f88b5443`
does not change the simulator/model/stencil sources, and rebasing preserved the feature's engine
sources byte for byte. This is an existing load-sensitive backstop, not an invariant counterexample.

For precision, two earlier isolated master attempts at seed `2092662136` passed both one- and
two-slot cases; they are not evidence of a master failure. A serial branch recheck at the actual
failing seed `-1353972177` still crossed the one-slot backstop. The three two-slot cases, checked
serially with their original seeds and ×20 counts, all passed:

`SUMMARY (two-slot x20 recheck): 3 passed, 0 failed, 0 unrun`

Follow up on the repeated baseline simulation work and the placement of this expensive property.
Preserve generated coverage, fixed scale examples, sampling assertions and zero-retry CI; do not
loosen the backstop to hide a counterexample. PR CI on the feature passed all checks before the
upstream tutorial rebase; the rebased branch receives fresh CI.
