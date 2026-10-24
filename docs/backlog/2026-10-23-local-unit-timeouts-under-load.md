## Local unit timeouts under shared-machine load

During #265 verification, `pnpm test --maxWorkers=2` reported eleven failures at the configured local five-second test timeout across `scalingPlanner.test.ts`, `examples.test.ts`, `controlLog.test.ts` and `breaker.sampling.test.ts`. The broad run was stopped after those reports to respect the verification budget; it did not produce a complete suite summary. No assertions or timeouts were changed.

Each affected file was replayed twice on a clean `git archive` of `origin/master` at `2c6a463cb0f79dfd44c025c06aad486120ddacc9`, inside this worktree's ignored output directory with the same installed dependencies, local timeout and two declared workers. These are targeted Vitest results, including its typecheck project, not full-gate results:

| Master spec                        | First replay        | Second replay        |
| ---------------------------------- | ------------------- | -------------------- |
| `src/sim/scalingPlanner.test.ts`   | 5 failed, 37 passed | 4 failed, 38 passed  |
| `src/sim/examples.test.ts`         | 132 passed          | 1 failed, 131 passed |
| `src/live/controlLog.test.ts`      | 3 failed, 41 passed | 44 passed            |
| `src/sim/breaker.sampling.test.ts` | 4 failed, 9 passed  | 2 failed, 11 passed  |

Every master failure reports `Test timed out in 5000ms`; type checks report no errors. The refined-peak planner case, the blocking-call example, fault-overlay replay and high-rate breaker cases reproduce failures from the branch run. The files are unchanged from master. Counts vary with contention, so these are local load-sensitive failures, not a claim that all tests fail deterministically. Local evidence is retained in `tests/.output/inspector-master-{scaling,examples,control-log,breaker}-{1,2}.log` and the interrupted branch run in `tests/.output/inspector-unit.log`.

Follow up by profiling the long simulation cases in the admitted gate environment and reducing redundant fixture work where possible. Keep their behavioral assertions and the existing CI configuration; do not increase the local timeout to conceal contention. The requested Linux Inspector gate could not acquire capacity on either attempt (exit 75); another live gate held the complete 12-worker budget. No gate summary was produced for those attempts.
