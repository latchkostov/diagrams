## Simulation test backstops under shared CPU load

On 2026-10-23, the vendor-stencil branch's ordinary two-worker unit run hit six
existing five-second backstops in checks/example evidence, sampled waiting,
scaling-planner refinement and retry parity tests. No assertion or timeout was
changed. Three separate new-example inventory failures were fixed in this branch.

Only the affected cases were checked twice on a clean checkout of
`origin/master`, `39af0c91eae340bf903313456533069b9aeb3cd9`, inside this worktree's
ignored test-output directory with the same installed dependencies. The first run
reproduced the five-second timeout in `checks/examples.test.ts`'s `blocking-call`
case and `retries.noop.test.ts`'s `w1-busy-threads` case: 2 failed, 60 passed,
150 skipped. The second run passed: 62 passed, 150 skipped. The other selected
cases passed on both master runs. This demonstrates load sensitivity, not a
consistent failure of every case.

The final branch rerun covered all six timed cases and the three corrected
example inventories: 92 passed, 312 skipped, no type errors. The initial complete
run reported 14,496 passed, 9 failed, 10 expected failures and 10 skipped;
it was not repeated. PR CI remains responsible for the complete final suite.

Follow up by identifying avoidable simulation work or operation-count checks in
these cases, following `docs/QUALITY.md`. Preserve outcome assertions and avoid
raising wall-clock limits to hide a regression.
