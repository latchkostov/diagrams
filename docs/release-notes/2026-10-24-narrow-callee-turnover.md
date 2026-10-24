## Narrower processor accuracy

Blocking callers with an unbounded connection pool now count downstream queue time once
when a narrower sampled processor has already paced that queue through its reservations.
Previously the caller stretched that time again, delaying new calls and leaving the
bottleneck idle. The correction belongs to the live caller reservation and reply edge;
automatic sampling still follows the entry-rate budget, with no global cap or extra dots.

The four-slot caller / one-slot, 30 ms service regression now completes 670 requests at
the automatically selected scale 10 versus 662 at scale one over identical 20-second
arrival instants. The difference of 8 is within the unchanged I1 allowance of 33.24;
before the fix scale 10 completed 570. The regression includes an unrelated 500 requests/s
source that raises the sampling budget, and fails with the original engine restored.

## Output inventory

Node output parity: 3,016 goldens checked, none changed, added, missing or stale.
No parity goldens were re-recorded. The existing Vitest snapshot
`src/sim/__snapshots__/scaleEquivalence.heavy.test.ts.snap` changes only the sampled
slow-callee row: caller, partner and result processed counts each rise from 570 to 670.
Its baseline, source count, failures, rejections, drops, timeouts and late replies stay
unchanged. The former expected I1 failure is now an ordinary passing regression.

## Sweep verification

The requested Node 24, CI=true sweep completed all 40 multiplier-5 seeds and all
four multiplier-20 seeds: 43 passed, one failed. The sole failure, resilience seed
`538282733`, reproduces identically twice on clean master at `e82d178b`: 11 messages
remain after the recovery bound in a finite-pool scenario. Its exact replay and
the complete sweep inventory are recorded in the
[backlog fragment](../backlog/2026-10-24-finite-pool-resilience-recovery.md).
