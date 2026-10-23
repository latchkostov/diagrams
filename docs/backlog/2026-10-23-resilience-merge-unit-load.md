## Native timeout backstops during the resilience merge

The native `pnpm test --maxWorkers 2` run on the #255/#257 merge reports 15,191 passed,
six failed, ten expected failures and ten skipped, with no type errors. All six failures
hit the existing five-second backstop: three scaling-planner cases, retry-storm simulation
evidence, the 500 CPU-ms sampled caller, and the busy-thread retry no-op comparison.
No engine code, assertion or timeout was changed.

Only affected specs were checked in an untouched archive of origin/master
`d0c3f96deb2ed6f5a8615cfde3bf1c668ced379a`, extracted inside this checkout's ignored
output directory with the installed dependencies linked in. No full master suite ran.
The scaling-planner spec ran twice: each reported 40 passed and two timeout failures,
reproducing the decision-capacity and refined-peak cases. The sampled-wait and retry-no-op
specs ran twice: each reported 67 passed and one timeout failure, reproducing the same
busy-thread retry comparison. Logs: `tests/.output/merge-master-scaling-{1,2}.log`
and `merge-master-waits-{1,2}.log`.

The focused retry-storm evidence case passed both master checks. The capacity-reduction
and retry-storm evidence cases passed a focused branch check (36 passed, 110 skipped,
including type tests); sampled callers passed their focused branch check (23 passed,
31 skipped). Those three initial failures are transient observations, not identical
current-master reproductions. Continue the existing unit-load investigation without
weakening assertions or increasing timing budgets.

The requested Linux quick gate with two repeats returned busy (75) on both admission
attempts. An additional full Linux gate was stopped during unit coverage to honor the
task's verification budget and busy-gate push rule; Docker smoke, lint, typecheck,
formatting, i18n and skill checks had passed. It produced no SUMMARY or verified stamp.
Its container and temporary volumes were cleaned up. Complete verification remains with CI.
