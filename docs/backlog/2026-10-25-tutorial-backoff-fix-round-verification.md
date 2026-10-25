## PR #339 backoff timeout verification

Additional evidence for [the existing backoff sweep timeout](2026-10-25-tutorial-backoff-sweep-timeout.md):
`backoff-budget: jitter fails the backlog expectation but the same seeded budget run recovers` in
`src/tutorials/completionSweep.test.ts` exceeded its 5,000 ms hang backstop during PR #339 fix-round verification.
Its assertions and timeout were left unchanged. The final tutorial unit run reported **1 failed, 2,253 passed,
119 skipped**; this was its only failure.

A clean tracked-file snapshot of `origin/master` at `45e79585d16987f198ea4bf43461fd549d149e16`, extracted inside
this worktree's ignored test output directory and using the installed dependencies, reproduced the same timeout.
Only that case ran twice with one worker: the first run reported **1 failed, 1,586 skipped** (5,134 ms timeout);
the second reported **1 passed, 1,586 skipped**. Investigate its simulation workload and scheduling without
loosening its checks.
