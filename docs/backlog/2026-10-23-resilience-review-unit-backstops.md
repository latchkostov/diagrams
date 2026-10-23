## Heavy unit hang backstops during #255 review fixes

The native `pnpm test --maxWorkers=4` run on Node 24.22.0 recorded 14,866 passed tests,
12 five-second timeout failures, 10 expected failures and 10 skipped tests. The affected files were
`src/checks/examples.test.ts`, `src/examples/retry-storm.test.ts`, `src/sim/scalingPlanner.test.ts`,
`src/sim/waits.sampling.test.ts` and `src/sim/retries.noop.test.ts`. No assertion mismatch or type
error occurred. This extends the evidence in `2026-10-23-heavy-unit-hang-backstops.md`.

Only affected specs were reproduced twice on clean tracked sources archived from `origin/master`
(`78be9ef4`) into an ignored directory in this workspace, using the same installed Vitest and Node.
No other worktree or branch was touched. The examples, retry-storm and scaling-planner reproduction
reported `Tests 5 failed | 151 passed (156)` and `Tests 4 failed | 152 passed (156)`, respectively.
Both runs reproduced the existing five-second examples/scaling timeouts; the retry-storm seed tests
passed when isolated. These are intermittent local hang-backstop failures, not changed semantic
assertions. Logs are retained in `tests/.output/review-master-units-{1,2}.log`.

All five affected files passed on the feature branch with the repository's existing CI configuration:
`Test Files 10 passed (10)`, `Tests 224 passed (224)`, no type errors. No test timeout, assertion,
fixture or implementation was changed to obtain this result. Follow up on deterministic work and
fixture size under contention, preserving meaningful operation-count checks and semantic coverage.
