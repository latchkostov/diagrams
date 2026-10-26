## Existing simulation-heavy timeout backstops under contention

During the engine split's ordinary unit/heavy run, these unchanged specs hit Vitest's existing 5-second whole-test
backstop. No behavior assertion or timeout was loosened. A clean checkout of `origin/master` at
`a2506160a5177ec55ab46a5a44b937ac9d695303`, within this workspace's ignored test output, reproduced the failures
with the same Node 24.22.0 and dependencies:

| Spec and cases                                                                                                                                                                    | Clean-master run 1      | Clean-master run 2      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ----------------------- |
| `src/sim/scalingPlanner.heavy.test.ts`: capacity-in-force decisions; refined peak's Capacity ×                                                                                    | 1 timed out, 20 passed  | 2 timed out, 19 passed  |
| `src/checks/examples.heavy.test.ts` and `src/examples/retry-storm.heavy.test.ts`, with only the other failed specs (`retries.noop`, `threadFixPlan`, `reviewLoop`) alongside them | 6 timed out, 146 passed | 5 timed out, 147 passed |

Both planner cases reproduced; the refined-peak case failed in both whole-spec runs. Selecting just those two
cases had passed twice, so whole-spec order/load matters. Both remaining-spec runs reproduced checks on
`blocking-call`, simulation evidence on `retry-storm` and `blocking-call`, and retry-storm outcome bands at seeds
7 and 42; seed 17 also timed out in the first run. Other original timeouts cleared in targeted reruns.

These were targeted spec runs, not clean-master full suites. Keep the seeded outcomes and behavior assertions;
investigate workload cost, isolation and whole-test hang backstops under load separately from the pure move.

On the stable extraction, rerunning only the seven affected specs produced 170 passes and five identical
timeouts: the blocking-call check, retry-storm evidence, retry-storm seed 17, and both planner cases. Every one
of those five reproduced above on clean master. `reviewLoop`, `threadFixPlan`, `retries.noop` and the stable
engine-version test passed. The initial broad run had 13,210 passes, 15 failures, 10 expected failures and 156
skips; its in-flight source-hash mismatch cleared once source edits stopped. The tutorial and decoration
timeouts have separate evidence fragments.
