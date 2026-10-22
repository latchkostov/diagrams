## Unreproduced failures under Linux browser load

The resilience feature's final full gate at `e1cb658645b49169e22d19878d500f081d88d0fa`
passed all unit tests and parity, but two existing browser tests failed with 12 workers and
12 container CPUs. Neither failure is established as pre-existing or as a feature regression.

- `collab-c1a.spec.ts`, "pasting Private content stops sharing before the paste reaches peers or room recovery":
  the download started roughly seven seconds into the test, then `createReadStream()` stalled until
  the 30-second test timeout canceled it. The copied-content assertions were not reached.
- `slowmo.spec.ts`, "an open Inputs panel and capacity Apply fix wait until slow motion ends":
  capture completed after roughly 8.6 seconds, after the existing seven-second readiness assertion.
  The trace shows the trace-card chunk loading when capture completed. No assertion was relaxed.

## Evidence

Full gate: `pnpm gate full --linux --workers 12 --cpus 12 --max-wait 1`.

```text
SUMMARY: e1cb658645b49169e22d19878d500f081d88d0fa | unit={"passed":14065,"failed":0,"skipped":8} parity={"goldens":3080,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":2019,"failed":2,"flaky":0,"skipped":0} gate_failures=1
```

Only those two specs were then run on clean `origin/master`, once with two repetitions and the
same worker/CPU settings. Both repetitions passed; this does **not** prove the failures predate
the feature. Both tests also passed in the earlier 10-worker feature full run, whose failures
were two subsequently corrected example-list expectations.

```text
SUMMARY: 4877f5dce3595a83af56043f726fb1f929fedd87 | unit="not run" parity="not run" e2e={"passed":76,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

Local reports: `tests/.output/g/r1KiYDw` and
`tests/.output/resilience-master/tests/.output/g/r7QyT6J`.

## Follow-up

Use the next CI result and retained traces to distinguish browser download completion from
application behavior, and capture scheduling from engine throughput. Preserve the privacy,
download-content and disabled-control assertions. Follow the verification budget: no further
full-suite baseline runs to establish these intermittent failures.
