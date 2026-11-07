## Native Istanbul coverage under concurrent verification load

PR #438's Windows run of `pnpm test:coverage --maxWorkers=3` completed with
22 five-second test backstop failures, 15,602 passes, nine expected failures and ten skips.
All six caching tutorials' completion-contract cases passed. The earlier Linux coverage lane
on the pre-fix head passed 15,650 tests with ten skips.
The diagnostic command's surplus heavy lane was cancelled after that coverage result;
its interrupted gate produced no verification summary or stamp.

Clean `origin/master` sources at `85bc26c10b4480177568cf98a9812e683225c7fd` were exported
inside the existing workspace, with no second git worktree. Targeted Istanbul runs used one
worker and `--repeats=1` (two executions per test), with the same unchanged backstops.
They reproduced these Windows timeout signatures:

- `src/live/decorations.test.ts`: paused seek/checkpoint queue attention, three quick retries.
- `src/live/threadFixPlan.test.ts`: inspector's verified busy-thread policy.
- `src/live/cacheFixPlan.test.ts`: one-fetch confirmation, seed 7.
- `src/live/callFailureRate.test.tsx`: settled failures versus recently started attempts.
- `src/checks/requestsWait.test.ts`: matching Check, callout and planner edits.
- `src/examples/largeShowcases.test.ts`: deterministic public commerce showcase replay.
- `src/sim/cacheAgreement.test.ts`: short stale-window observations with 1,000 items,
  scales 1/auto and seeds 1, 7, 17, 42 and 99 (ten failing identities).

The remaining five coalesced-fill agreement seeds (1, 7, 17, 42 and 99), and the retry-storm
completion regression, passed twice on clean master when targeted. The branch's targeted
retry-storm regression also passed twice. These six full-run timeouts have not been reproduced
on clean master and are not claimed as confirmed pre-existing failures. CI-equivalent final
verification uses Linux.

Follow up on native coverage workload isolation and sampling-test placement. Preserve every
assertion, seed and operation count; do not raise the backstops or re-record output.
