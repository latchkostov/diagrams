## Native reply readiness

Windows master Nightly 41346662217 fails the held-verification case in `requests-wait-review.spec.ts`: the request count remains one through the assertion window. The trace subsequently records the real first reply and the latest replacement, bringing the count to two. This is an assertion racing a real worker reply while the page clock is paused, not evidence that the single-flight product contract is broken.

The test now uses the existing `waitForThreadVerification` observer before asserting the exact replacement count. That observer waits for genuine worker messages and drains their promise chain through MessageChannel, including a stale flight's latest replacement; it works with the paused page clock. Keep the existing checks for one outstanding request, exactly two total requests, increasing revision and the final Capacity control.

The regression temporarily holds the real first request until the driver enters the reply wait. Removing only that wait makes the guard fail because the driver finishes while the request remains held. The fixed source is restored and hash-checked afterward. Both Windows production-build repetitions pass with the wait. No timeout, tolerance, budget or retry is increased, and no case is skipped.

## Validation

The entire touched spec passes twice in the Linux container: 12 executions, three workers sharing three CPUs, zero failures, flakes or skips. Its exact summary (the test-driver source is uncommitted on the stated starting HEAD):

```text
SUMMARY: 63edd001632aa395be9f94ef015a545280e4008d | unit="not run" parity="not run" e2e={"passed":12,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

Application bytes are unchanged from the preceding selection fix, whose full parity (3,178 unchanged goldens), production build, size, startup/reserve heavy tests and 505-execution Linux camera cohort pass. The final native branch Nightly and remaining groups are reported in the round-eight PR. Lint, typecheck, format check and repository-wide Prettier check run immediately before the signed commit.
