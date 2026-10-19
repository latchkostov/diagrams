## Unconfirmed Confluence timeout during PR #189 replay recovery verification

Runtime commit `8cf9761f771d2a0ecd667cf34d2826e621b40da1` passed the targeted production browser regression, all 2,694 Live/sim unit tests, and deliberate regression checks with the replay, timeline, cache and selection fixes removed. Final lint, typecheck and formatting passed; lint retains six existing warnings. Regeneration and i18n validation passed. An initial full-gate preflight selected Node 20; the actual run used the pinned host Node 24.22.0.

The single complete Linux archive gate used eight workers/eight CPUs and zero retries. All static checks, 11,839 unit tests (four skipped), production builds, entry/viewer size and all 2,672 output goldens passed. Entry size is 108.9 kB gzip against 123.5 kB; viewer size is 579.3 kB against 805.0 kB. No golden was re-recorded.

```text
SUMMARY: 8cf9761f771d2a0ecd667cf34d2826e621b40da1 | unit={"passed":11839,"failed":0,"skipped":4} parity={"goldens":2672,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":1773,"failed":1,"flaky":0,"skipped":0} gate_failures=1
```

The only failure was `confluence-dc.spec.ts:30`, the attachment variant: a 30-second whole-test timeout, followed by the cleanup navigation at line 183 reporting that the page had closed. This spec is unchanged from origin/master. Its cause is unconfirmed; do not classify it as a reproduced pre-existing failure.

Only that spec was run twice on a clean copy of origin/master inside this worktree, using Linux archive transport, four workers/four CPUs and fresh production profiles, alongside the eight-worker branch gate:

```text
SUMMARY: 438e4819d8b2d44efbefe0e674aef7e22beddc02 | unit="not run" parity="not run" e2e={"passed":6,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

The identical focused comparison on the branch also passed both repetitions:

```text
SUMMARY: 8cf9761f771d2a0ecd667cf34d2826e621b40da1 | unit="not run" parity="not run" e2e={"passed":6,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

Investigate full-invocation workload and the macro test's clock/navigation/teardown interaction before changing behavior. Keep its assertions and timeout. No complete master suite or repeated full branch suite was run. The signed follow-up commit records verification only; executable code remains the runtime commit above. Per the verification budget, record these results and push without another full-suite run.
