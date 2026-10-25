## Stencil accessibility timeouts under the mixed full-suite load

The single full Linux gate on `5a25e70381f85907172bec0b51118450f714540c` used the pinned
Playwright image, 12 CPUs and 12 workers. Both `a11y.spec.ts:264` stencil sweeps (light and dark)
exceeded their existing 30-second whole-test backstop; the dark case identifies `axe.analyze()`
through `AxeBuilder.runPartialRecursive`. Neither the accessibility spec/helper nor product code
changed in this branch. This does not establish the cause of the timeouts.

Stopped the remaining browser cases after those failures, following the verification-budget rule.
Playwright recorded 506 passed, 2 failed, 12 interrupted and 1,897 not run. The gate combines the
last two groups into 1,909 skipped; those are interruption counts, not new test skips. Every preceding
gate step passed, including unit/heavy tests, Docker, build/size and all 3,151 parity goldens.

```text
SUMMARY: 5a25e70381f85907172bec0b51118450f714540c | unit={"passed":10672,"failed":0,"skipped":17} parity={"goldens":3151,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":506,"failed":2,"flaky":0,"skipped":1909} gate_failures=1
```

## Bounded clean-master comparison

In this same worktree, checked out clean `origin/master` at
`58032de3c68d78e650f092231449e1764f097254` and ran only the affected spec twice:

```sh
pnpm gate quick tests/e2e/a11y.spec.ts --linux --workers 12 --cpus 12 --only e2e --repeat 2 --max-wait 1 --ports 6660
```

Both repetitions passed all 42 cases: **84 passed, 0 failed, 0 flaky, 0 skipped**. Restored the feature
branch afterwards. No other worktree or stash was used. The comparison does **not** reproduce the full
run's failures and must not be described as confirmation of an identical clean-master failure.

```text
SUMMARY: 58032de3c68d78e650f092231449e1764f097254 | unit="not run" parity="not run" e2e={"passed":84,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

## Follow-up

If CI reproduces the timeout, inspect the full-catalog axe sweep under mixed load. Consider splitting
it by catalog category while explicitly preserving coverage of every stencil and the surrounding
chrome. Do not increase the backstop, disable contrast rules or reduce the covered catalog. No flake
ledger entry was added for this unconfirmed load failure. PR CI covers the browser cases left unrun
locally; no second full suite is queued.
