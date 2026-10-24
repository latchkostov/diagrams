## Native Windows baseline before the E2E CI optimization

The unmodified application at `origin/master` (`069291556bb345348d306ef171a4fcde7a4d8e81`)
was checked by the baseline reporting commit `4b629d51a11f6ad61a7ee49d7f785cdc97698008`.
That commit adds only the CI timing reporter, its declarations and its two unit tests;
it changes no application, E2E spec, build profile or workflow.

`pnpm gate full --workers 12 --max-wait 1` on Windows completed with:

```text
SUMMARY: 4b629d51a11f6ad61a7ee49d7f785cdc97698008 | unit={"passed":10326,"failed":0,"skipped":5} parity={"goldens":3147,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":2285,"failed":26,"flaky":0,"skipped":4} gate_failures=1
```

Failures span `a11y`, `bundle-trim`, `confluence-forge`, `edge-shaping`, `editor`,
`lab`, `latency`, `routing` and `viewer-bundle`. They include the light inspector's
4.38:1 contrast reading, a quick-add label still containing its default, Windows
browser-context teardown timeouts, and preset sweep timeouts. The full local report
is retained in `tests/.output/g/rUwfcxz` (untracked).

A clean checkout of `origin/master` at the SHA above was made in the same worktree.
The focused command selecting only those nine specs with `--only e2e --repeat 2
--workers 12 --max-wait 1` exited **75 before running tests**, because a concurrent
three-worker run held capacity. There is no clean-master test SUMMARY and no claim
that these failures were reproduced by that attempted replay. Continue through PR
CI under the documented busy-gate exception; do not weaken assertions or rerun the
full suite on master to hide these results.

Follow up with the nine specs on native Windows when capacity permits, comparing
exact failing test identities and errors. The E2E CI optimization uses Linux; its
PR measurements and results are recorded separately in the PR.
