## Existing unit timeout backstops under shared load

During message-type picker verification, the initial two-worker full unit run reported 19 failures (14,260 passed). Four belonged to this feature and are resolved: the webhook's intended route snapshot, two closed-Inspector language renders, and the broker-inspector no-serialization contract. The final targeted selection passes 120 tests on each of three runs. Fifteen initial failures were timeout backstops; no timeout or assertion was loosened.

## Clean-master evidence

A clean git archive of origin/master at 5f47cc876f6c7a37046b3efe71653ca38fe25a6e was extracted inside this worktree's ignored test output, with the installed dependencies linked in. Only failing spec files were run, twice each; no full clean-master suite was run.

- src/checks/examples.test.ts: repeats report 3 and 4 failures (99 and 98 passed, including the typecheck project). The second reproduces all four original failures: blocking-call in the ordinary checks, and retry-storm, scale-on-busy-threads and blocking-call in evidence.
- src/sim/scalingPlanner.test.ts plus waits.sampling.test.ts and sync.test.ts: repeats report 3 and 2 failures (121 and 122 passed). The first reproduces all three Capacity-change planner timeouts; the second reproduces the sampled resource caller CPU-residence timeout. Sync passes on clean master.
- src/live/threadFixPlan.test.ts: both repeats report 2 failures and 14 passed, reproducing the verified busy-thread policy timeout and a second affordable-timeout backstop.
- src/sim/retries.noop.test.ts: both repeats report 1 failure and 13 passed, reproducing the busy-thread byte-parity timeout.
- src/checks/scalingFindings.test.ts and services/server/test/bundle.test.ts: both clean-master repeats pass (10 tests including the typecheck project). Their focused branch rerun also passes, together with the repaired broker inspector (12 tests total).
- A focused branch rerun of sync.test.ts clears the original upstream-policy case but times out in a different unchanged git-orchestration case; this is recorded as transient and is not claimed as an identical clean-master reproduction.

## Follow-up

Investigate the existing simulation/planner and git-orchestration backstops on shared-load hosts with the gate's resource admission. Retain semantic assertions and operation/count/ratio guards; do not replace the failing checks with larger absolute performance budgets. Final delivery records the completed gate SUMMARY and any admission exit 75 separately.
