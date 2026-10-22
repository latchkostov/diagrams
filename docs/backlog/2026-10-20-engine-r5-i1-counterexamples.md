## Sampling accuracy

Goal: turn I1 on as a full generated property, preserving every existing property and stricter
assertion. I1 bounds the difference in real processed, failed, rejected, dropped, timed-out and
late counts over at least 20 seconds of constant traffic by
`N * (ceil(S / N) + 1) * (1 + faults) + 0.02 * baseline`.
Latency p50/p95 comparisons apply only when every pool is divisible by N.
Investigate the unresolved gaps below; do not filter generators, weaken admission invariants,
or permit tiny, effectively permanent reservations. The wait-test wrapper rework belongs here too.

The remaining original managed-admission reproduction is a named `it.fails` test in `src/sim/scaleEquivalence.test.ts`,
using `src/test/scaleEquivalence.ts`. A correction must remove the corresponding expected-failure
marker. Existing gating properties stay unchanged; generated I1 is opt-in exploration with no quarantine predicate.
These cases inject 100 real requests/s for 20 seconds, quantized at cohort boundaries, with seed 7.
I1 now compares scale 1 at the sampled arrival instants (`sameArrivals`), rather than continuous
scale-one traffic; every surviving gap simulates in `beforeAll` and has an ordinary exact-value pin.
Numbers below are real caller/worker completions, not dots.

## Legacy queue workers

Resolved in sampling PR 3: W1 processors outside the call graph retire through the ledger;
`serviceCredit` remains only for pre-W1 processors and gateway ceilings. Ordinary I1 regressions
pass at scales 1.01, 1.1 and 2.5. Real completions improve from 1,008.99 to 1,996.77 against
the same-arrivals scale-one 1,997 reference at 1.01; from 1,098.9 to 1,996.5 against 1,997 at
1.1; and from 1,665 to 1,997.5 against 1,996 at 2.5. Caller occupancy semantics are unchanged.
Generated parent: seed `20261018`, path `0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:2:2`.

## Managed request admission

A fixed one-slot Lambda caller, 10 ms API work, one connection and a zero-work service callee,
fed by a queue: same-arrivals scale 1 completes 662 (continuous: 666); scale 1.01 completes 399.96 after the PR 2 turnaround correction (previously 335.32).
Allowed difference: 15.26. At scale 2.5 the same-arrivals reference is 599 versus 500 sampled (previously 400).
The caller does real API work; its retained managed lease gates admission. Trace request release
versus admission ordering and retained holds. The zero-local-work correction does not apply.
Diagnostic parent: seed `20261018`, path
`0:1:0:0:0:1:1:0:0:0:0:0:0:0:0:0:0:0:0:1:2:2`, with independent siblings removed.

## Fractional capacity fragmentation

Resolved in sampling PR 4: all three allocators share the approved packing rule, preserving
the minimum-one-real-request guard. Ordinary I1 regressions pass at scales 1.1, 1.3 and 1.5.
Two zero-work caller slots, one zero-work callee slot and one connection: scale 1 completes
999; scale 1.1 improves from 878.9 to 998.8. Allowed difference: 22.18. The earlier 1,998 / 1,098.9
figures predated #222, when the connection pool was not executed. Previously a cohort reserved 1.1 real units,
leaving 0.9; the minimum-one-real-request gate refused another cohort. This occurred without a
retained thread hold and is independent of the zero-work admission-lag correction.
Diagnostic parent: seed `20261018`, path `3:0:1:1:1:1:1:0:0:0:0:0:0:0:0:1`.
Preserve the small-reservation guards when investigating fragmentation.
At scale 10 the same fixture improves from 580 to 1,000 against 995 in sampling PR 5:
the one connection now holds the caller thread until it turns the cohort over (below).

## Sub-tick local work

Two ordinary one-slot, one-replica services each have 1 ms local work and zero jitter. Their
Request uses one connection, blocking wait, zero reply work and 10 ms physical network delay.
Resolved in sampling PR 2: lag follows the remaining tick admission opportunities. Ordinary I1
regressions pass at scales 1.5, 2, 3 and 4. Release quantization is unchanged.

## Zero-local-work correction retained in R5

Threads with no local work start during admission itself and must not add another work-loop
admission lag to their sampled hold. The named regressions at scales 1.01 and 2.5 keep the original
I1 bound. Without the correction, 999 scale-one completions become 671.65 and 665 respectively
(allowed differences 22 and 24.98). That correction originally left all four
accuracy investigations open; PR 2 now resolves the sub-tick gap through tick-phase tracking.

## Additional same-arrivals pins (PR 1)

All are in `src/sim/scaleEquivalence.test.ts` with the unchanged I1 bound and exact siblings:

- CPU callee (2 slots, 24 ms CPU) behind one connection, caller 2 slots: resolved in sampling PR 5.
  A finite pool narrows the cohort's width, so the callee's first wave runs at the connection's
  grant instead of min(N, slots); a caller thread wider than its pool lease is not admissible
  before that lease's exact turnover. Ordinary I1 regressions pass at 1.1, 1.5, 2, 2.5, 5 and 10
  (scale 2: 400 versus 399, previously 286; scale 10: 400 versus 397, previously 180).
- Same CPU fixture without a connection pool, scale 1.1: 570 versus 664.4 after PR 4 packing
  (previously 366.3); closer to the reference but still outside I1, pending the CPU-tail PR.
- Lambda joining ordinary and fleet replies: resolved in PR 2; ordinary I1 guards pass at scales 2 and 4.
- Slow 1-slot callee (30 ms), caller 4 slots, no pool or CPU, scale 10: 662 versus 570.

The deadline cohorts live in `deadlineScale.invariants.test.ts`: scale 2 pins 1,779 versus 510
completions/late replies and remains an expected failure. Scale 10 pins 356 versus 330 and passes
by coincidence within 27.12; continuous scale 1 remains pinned at 2,964. The two burst-at-zero
exact-equality deadline regressions remain expected failures; converting them to I1 would loosen them.

Generated I1 is opt-in exploration (`FC_I1=1`, `scripts/fc-sweep.mjs --i1`), never a CI gate.
The fixed corpus is separately replayable with `FC_I1_CORPUS=1 pnpm exec vitest run
src/sim/scaleEquivalence.test.ts -t "fixed 40-sample" --silent=false`; its 40 samples use seed
20261018: **13/31 pass** at scale > 1 on PR 1, matching the approved design. Each later sampling PR
records the pass count without lowering this floor: 16/31 after PR 4 and PR 5 (the test's floor is 16).
