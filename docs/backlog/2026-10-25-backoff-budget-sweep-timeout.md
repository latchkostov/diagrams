## Backoff-budget completion sweep timeout

The tutorial unit run for PR #347 round 1 reported 2,283 passed, 119 skipped and one failure:
`backoff-budget: jitter fails the backlog expectation but the same seeded budget run recovers`
exceeded Vitest's existing 5,000 ms test timeout. The isolated test also timed out on this branch.

The same isolated test was run twice against a clean archive of origin/master at `762534298`
inside this worktree, using the installed dependencies and two workers. Both runs reproduced
`Error: Test timed out in 5000ms.` Each summary was `Test Files 1 failed (1)` and
`Tests 1 failed | 1681 skipped (1682)`. No full suite was run on master.

Investigate the seeded workload and completion path without weakening its assertions or adding
an elapsed-time performance budget. The fan-out/RAG regressions pass independently.
