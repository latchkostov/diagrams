## Pooled deadlines at sampled scales

A connection pool with a deadline now dispatches partial cohorts, retaining unsent members in FIFO order until their shared deadline. Only dispatched work can finish downstream or reply late. A successful first wave keeps one caller outcome while its remaining edge work continues independently; checkpoints preserve that remaining work and its deadline. Existing local thread waves remain represented without changing source arrival instants.

The original exact comparisons are ordinary passing tests, with no relaxed invariant thresholds:

| Pin                                                                           | Before at sampled scale | After              | Same-arrivals scale 1 |
| ----------------------------------------------------------------------------- | ----------------------- | ------------------ | --------------------- |
| `deadlines.test`, N=10: processed / timed out / late / delivered / dispatched | 10 / 10 / 0 / 10 / 1    | 3 / 18 / 1 / 3 / 3 | 3 / 18 / 1 / 3 / 3    |
| `queuedDeadline`, N=10: processed / delivered / late                          | 10 / 10 / 10            | 1 / 1 / 1          | 1 / 1 / 1             |
| `deadlineScale`, N=2: processed / late / caller failed                        | 508 / 508 / 3584        | 1779 / 1779 / 3584 | 1779 / 1779 / 3584    |
| `deadlineScale`, N=10: processed / late / caller failed                       | 330 / 330 / 3580        | 356 / 356 / 3580   | 356 / 356 / 3580      |

The continuous scale-one reference remains 2964 / 2964 / 3584; the comparison uses identical arrival instants, as approved. Disabling cohort creation makes all three exact regression files fail again (seven failing tests).

## Resource and outcome rules

A deadline ends the dispatched pool leases and cancels the unsent tail; dispatched work can still return late. Ordinary failures retain the established aggregate residence where the grant holds a whole request. The caller's outcome and breaker decision remain attached to the first wave. Later orphan expiry counts unfinished work on the edge and never rewrites a settled caller or breaker. Edge timeout totals can consequently exceed caller failures at sampled scales.

Probe results settle before the pool wakes its next cohort, through the ordinary reply path. A regression confirms that a successful half-open probe does not short-circuit the next queued cohort.

Regressions cover orphan replay and cleanup, exact expiry, blocking and non-blocking pools, nested unpooled calls, fractional breaker recovery, and cohort/lease ownership. Throttle and broker implementation, source arrival scheduling, debt quantization and early-release policies are unchanged.

## Output parity

No Node-tier golden changes: all 3020 goldens remain byte-for-byte unchanged, including every scale-one golden. There are no moved goldens requiring direction exceptions or re-recording. Existing public deadline examples continue to demonstrate the corrected behavior; this fix adds no authoring feature or control.

## Known mixed-deadline limit

A successful first wave still completes the caller's whole dot. The mixed reply/deadline I1 limitation identified by the approved design remains: in twenty isolated bursts of twenty requests, scale one records 40 caller successes / 360 failures, while scale ten records 200 / 200. Both runs agree exactly on 60 downstream completions, 360 edge timeouts and 20 late replies. An exact pin and an accuracy-only expected failure record this limitation for stage 9; no comparison bound was changed. See [the backlog note](../backlog/2026-10-25-sampling-mixed-deadlines.md).

## Exact held-gauge drain

Nested partial waves can create very small blocking-call charges. The held gauge now keeps those charges until their matching release and becomes exactly zero when its last blocking branch ends. This closes the R6 idle-holds counterexample from seed 1946752105 without changing an invariant threshold, request scheduling, pool residence or retry policy. The regression fails when the former rounding update is restored.
