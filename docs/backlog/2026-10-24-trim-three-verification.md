## Trim 3 verification follow-ups

The unit run on trim 3 (`origin/master` base `bc93cf19`) timed out at the unchanged 5-second
backstop in `src/live/decorations.test.ts` (the `three-quick-retries` paused-seek/checkpoint case)
and `src/live/threadFixPlan.test.ts` (the verified busy-thread policy case). Only those specs plus
the package-manager probe were run twice against a clean, tracked-only archive of `origin/master`
inside this checkout: pass/fail totals were 20/2, then 21/1. The decorations timeout reproduced
both times and the thread-fix timeout once; assertions and timeouts are unchanged. Package-manager
probes passed in both clean-master runs and in their focused head rerun.

The eager quick-add integration in `tests/e2e/bundle-trim.spec.ts:139` sometimes reads the old
persisted name immediately after the canvas and inspector have the typed name. Clean master
reproduced the identical `Cache audit` versus `Redis Cache` failure in a two-repeat Linux run
of that case and the two Markdown preview cases. Clean-master SUMMARY:

```text
SUMMARY: bc93cf19ecfd3c444b5355848d45e3fec53d7c93 | unit="not run" parity="not run" e2e={"passed":7,"failed":1,"flaky":0,"skipped":0} gate_failures=1
```

Keep the assertion until persistence readiness has a proved contract; do not hide the failure by
loosening the expected label. The searchable menu remains eager in trim 3. The initial broad stress
run also had two Markdown editor download-readiness failures; the selected clean-master run passed
those cases. They are not established as pre-existing by that run. A subsequent full neighbour repeat
passed all 155 cases without assertion changes.
