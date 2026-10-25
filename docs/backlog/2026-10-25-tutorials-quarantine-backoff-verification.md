## PR #339 quarantine-round backoff timeout evidence

The targeted `src/tutorials` run reported **1 failed, 2,212 passed, 161 skipped**. Its only failure was
the existing `backoff-budget: jitter fails the backlog expectation but the same seeded budget run
recovers` completion regression exceeding its unchanged 5,000 ms hang backstop. The separate Cells
sweep selection passed all 26 cases. No runner, timeout or assertion was changed.

The backoff case passed when run alone on this branch with one worker. Two isolated runs on a clean
tracked-file snapshot of `origin/master` at `b72a88ccb8e6774d3a446400a8f309245f954277`, extracted
inside this worktree's ignored test output directory and using its installed dependencies, also
passed (**1 passed, 1,586 skipped** each). This round therefore did not reproduce the timeout on
current master; earlier clean-master timeout evidence remains in
[the previous verification fragment](2026-10-25-tutorial-backoff-fix-round-verification.md) and
[the original timeout entry](2026-10-25-tutorials-backoff-timeout.md).

Investigate the existing simulation workload and scheduling in the resilience lane. The requested
quarantine round leaves that work deferred and does not rerun a full suite or change its runner.
