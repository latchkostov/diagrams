## Pooled deadlines at sampled scales

Calls with both a connection pool and a deadline can substantially understate downstream
completions and late replies at scale > 1. The I1 fixture in
`src/sim/deadlineScale.invariants.test.ts` records **2,964 vs 330** for both counts at scales 1 and 10.
Scale 1 is correct: queued calls that time out are never sent.

The full fix follows the [queued-cohort design](C:/Users/latch/bin/codex-tasks/rtw3-queued-cohort-design.md);
this gap is fixed by the sampling-accuracy PR. Its regressions are pinned with accuracy-specific `it.fails`
assertions; #197 keeps the existing engine behavior without partial-cohort changes.
