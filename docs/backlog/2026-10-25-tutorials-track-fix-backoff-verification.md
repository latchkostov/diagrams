## PR #344 fix-round backoff timeout evidence

The requested `src/tutorials` unit run reported **1 failed, 2,316 passed, 98 skipped**.
Its only failure was the existing `completionSweep.test.ts` regression
`backoff-budget: jitter fails the backlog expectation but the same seeded budget run recovers`,
which exceeded its unchanged 5,000 ms timeout. The track-order and gateway recovery tests passed.

A clean tracked-file snapshot of `origin/master` at
`5c1b901fc269c330aecaaa91a2dfd0a5685fa248`, extracted inside this worktree's ignored
test output directory, reproduced the same timeout in both executions of that case.
Only the named regression ran, with one worker and `--repeats=1` (two executions total).
Vitest reported **Test Files 1 failed (1)** and **Tests 1 failed | 1681 skipped (1682)**,
with two timeout failures for the repeated case. No full suite ran on master.

This corroborates [the earlier backoff timeout evidence](2026-10-25-tutorial-backoff-sweep-timeout.md).
Investigate the seeded simulation workload without increasing the timeout or weakening its assertions.
