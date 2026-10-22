## Unreproduced native Lab failures under full browser load

The retry-classification fix at `30eb034609625c33247309a19fe451f311c365ef` passed full unit coverage, production build, bundle budgets, all output parity and Docker deployment checks. The native full browser run failed seven Lab preset-sweep parts (1, 2, 3, 4, 6, 7 and 8). Two reported `net::ERR_INSUFFICIENT_RESOURCES`, one reported an aborted navigation, one could not read the Lab stage, and three reached the existing whole-test timeout. No other browser case failed.

These failures are **not established as pre-existing**, and no assertion or timeout was relaxed. The changed retry browser spec passed three repetitions in the quick gate. The 44-seed sweep passed all 40 ordinary and four heavy seeds.

## Evidence

Feature full run: `pnpm gate full --workers 12 --max-wait 1`.

```text
SUMMARY: 30eb034609625c33247309a19fe451f311c365ef | unit={"passed":14106,"failed":0,"skipped":8} parity={"goldens":3080,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":2012,"failed":7,"flaky":0,"skipped":4} gate_failures=1
```

Only `tests/e2e/lab.spec.ts` was then checked on a clean, separate checkout of `origin/master` inside this workspace, with independently installed frozen dependencies. The first 12-worker admission attempt exited 75 without running tests because another sweep held two slots. The actual check used the ten available workers and two repetitions, with unchanged assertions:

`pnpm gate quick tests/e2e/lab.spec.ts --only e2e --repeat 2 --workers 10 --ports 6680 --max-wait 1`.

```text
SUMMARY: 4877f5dce3595a83af56043f726fb1f929fedd87 | unit="not run" parity="not run" e2e={"passed":48,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

Feature report: `tests/.output/g/r9jDFJ8`. Baseline transcript: `tests/.output/review3-master-lab.log`; its checkout is recorded in `tests/.output/review3-baseline-path.txt`.

## Follow-up

Use PR CI and the retained native traces to distinguish accumulated browser resource pressure from an application regression. Preserve the Lab error and stage-readiness assertions. Following the verification budget, no further full-suite baseline run was queued to classify these intermittent failures.
