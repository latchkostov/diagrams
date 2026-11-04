## Investigate pending discovery download in the subpath browser project

The complete Linux gate on `885ca6bcf1459345636185d449648b9b86ae0e67`
fails only `tests/e2e/subpath.spec.ts:84`, which opens Browse examples and expects
every public card. The dialog remains on Loading: the ExampleDetails module request
is pending, without an HTTP response, when the unchanged assertion expires. The
other 3,394 browser tests pass; there are no flakes and 11 skips. No assertion,
timeout or application limit was changed to dismiss this failure.

## Comparison evidence

Only the failing spec was run twice on clean origin/master in the same worktree,
then the feature branch was restored. Both baseline and feature repetitions pass.
This does not prove that the full-gate failure is pre-existing.

Full gate, Linux, nine workers and CPUs:

```text
SUMMARY: 885ca6bcf1459345636185d449648b9b86ae0e67 | unit={"passed":16116,"failed":0,"skipped":13} parity={"goldens":3342,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":3394,"failed":1,"flaky":0,"skipped":11} gate_failures=1
```

Clean origin/master, only subpath, two Linux repeats, four workers and CPUs:

```text
SUMMARY: cdb0515c4baf5ab34b1f2fbc387bb267f9291877 | unit="not run" parity="not run" e2e={"passed":14,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

Feature branch, the same targeted command and resource limits:

```text
SUMMARY: 885ca6bcf1459345636185d449648b9b86ae0e67 | unit="not run" parity="not run" e2e={"passed":14,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

## Next evidence

Find why the production preview's discovery request did not complete during the
full run. Preserve the exact public-card assertion and existing limits. Do not
replace this unresolved observation with a claim that clean master reproduced it.
