## Backoff-budget completion sweep timeout on clean master

The targeted integration run for PR #335 passed 2,778 tests and skipped 101, but `src/tutorials/completionSweep.test.ts` → `backoff-budget: jitter fails the backlog expectation but the same seeded budget run recovers` exceeded its existing 5,000 ms hang backstop. A focused branch rerun failed identically.

A clean archive of `origin/master` at `e98a679e5db42a38d5f3fea5db319c136dd5c08d`, extracted under this checkout's ignored test output, reproduced the same timeout in both focused runs (one worker, unchanged source and timeout). Each summary was `Test Files 1 failed (1); Tests 1 failed | 1733 skipped (1734)`. No full suite was run on master.

Investigate this simulation-heavy completion regression independently. Do not change its timeout or quarantine it as part of the arrangement compatibility fix.
