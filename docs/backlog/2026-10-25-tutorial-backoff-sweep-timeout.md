## Backoff-budget completion sweep timeout

The completion regression `backoff-budget: jitter fails the backlog expectation but the same seeded
budget run recovers` exceeds the existing five-second test timeout when run in the completion sweep.
The focused test passes, but the full tutorial unit run reports 2,061 passed, 63 skipped and this one timeout.

Confirmed on clean `origin/master` at `489125be` in this same worktree with two runs of
`pnpm exec vitest run src/tutorials/completionSweep.test.ts --maxWorkers=1`. Both runs report
`Test Files 1 failed (1)` and `Tests 1 failed | 1380 passed | 147 skipped (1528)`, with the same timeout
in the same regression. This predates PR #337's observation and consumer-binding fixes.

Investigate the seeded run's cost in the sweep without weakening its assertions or increasing its timeout.
