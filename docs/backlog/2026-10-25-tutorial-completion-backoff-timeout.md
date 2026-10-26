## Completion sweep: backoff-budget hang backstop under local load

The existing `backoff-budget: jitter fails the backlog expectation but the same seeded budget run
recovers` case in `src/tutorials/completionSweep.test.ts` can exceed Vitest's existing five-second
whole-test hang backstop on this Windows Node 24 host. Do not loosen the assertions or add a timing budget.
Investigate the workload or scheduling independently of the tutorial navigation/catalog fixes.

Observed in PR #356 fix round 1: two-worker tutorial/i18n runs each reported 3,289 passed and one
failure at that backstop. The isolated case passes on the branch. A clean, detached origin/master
clone at `e5dac41b2` inside this worktree's ignored review directory ran only the affected spec twice,
with one worker: first `Test Files 1 passed (1); Tests 1862 passed (1862)`; second
`Test Files 1 failed (1); Tests 1 failed | 1861 passed (1862)`, with the identical test and backstop.
The isolated clean-master case also passes twice. No engine or test assertion was changed.
