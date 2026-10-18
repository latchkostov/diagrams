## Windows gate checkpoint rename collides with readers

The native S2 full gate completed with 11,213 passing unit tests, 1,663 passing browser tests,
zero failed/flaky tests, and all 2,364 parity goldens unchanged. Its exit status was nevertheless
1 because Playwright recorded one reporter error: `EPERM` renaming `checkpoint.json.tmp` to
`checkpoint.json`. A progress read with PowerShell `Get-Content` held the destination open while
the reporter attempted its atomic replacement. The failed result was retained; no suite was
rerun or report edited.

`scripts/gate/reporter.mjs` is unchanged from origin/master
`da6b7176d85c73b86dde581a6ca55e814256bf71`. To isolate the failure without another full run,
the clean master module was extracted with `git show` and its exported `writeCheckpoint`
called twice while .NET held the destination with `FileAccess.Read` and `FileShare.ReadWrite`
(without `FileShare.Delete`). Both attempts reproduced `EPERM`. Releasing the reader made both
unlocked control writes succeed. This reproduces the harness failure independently of S2.

Follow-up: make checkpoint replacement tolerate transient Windows sharing violations without
losing atomicity or suppressing persistent write failures. Progress readers should permit delete
sharing. Add a Windows regression that holds the destination open during replacement. Keep this
separate from the self-host server's static hosting and relay behavior.

The exact full-gate result (the later documentation commit only records this finding):

```text
SUMMARY: 68b5fe13d7555a7b0717cc168f26e9374a99503c | unit={"passed":11213,"failed":0,"skipped":4} parity={"goldens":2364,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":1663,"failed":0,"flaky":0,"skipped":4} gate_failures=1
```
