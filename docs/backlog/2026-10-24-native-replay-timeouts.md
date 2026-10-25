## Native replay hang backstops under concurrent load (2026-10-24)

The resilience-checks branch's native `pnpm test --maxWorkers=2` overlapped the required eight-worker
engine sweep. Several existing replay tests crossed the local five-second hang backstop. No assertion
was weakened or timeout changed. Focused checks using the repository's existing `CI=true` configuration
pass, including 148 tests across the affected waiting/health/check suites and the three selected sampling
cases. The broad native run is not a passing verification claim.

A clean archive of origin/master `8e58be7e421cd6b812d85ec0182a13244d59e8de`, inside this checkout's
ignored test output, ran only five suspected files twice with one worker under the same load. It
reproduced the exact five-second timeout in:

- `src/live/decorations.test.ts`: paused seeks/checkpoint restores, three-quick-retries (both attempts).
- `src/checks/requestsWait.test.ts`: public CPU example's identical primary edits (first attempt).
- `src/live/threadFixPlan.test.ts`: verified busy-thread policy before call-semantics changes (first attempt).

Master's first targeted attempt: **3 failed, 46 passed** across five files. Second: **1 failed, 48 passed**.
The selected run-end lesson and call-failure-rate files passed on master both times; they must not be
labelled proven master failures. The branch's focused CI-mode rerun passed those files too.

Follow up on the placement/workload of these replay tests and on running local verification with the
repository's intended CI hang backstops while reserving enough shared workers. Preserve behavioural
assertions and zero-retry CI; no broader clean-master suite was run.
