## Markdown export downloads under Linux load

P2-B's five-repeat, eight-worker/eight-CPU Linux neighbour run passed 688 cases and timed out twice in
repeat two: `cold Markdown keeps annotation geometry and image exports await the rendered text` and
`Markdown export measures decoded header images`. Both reached `download.path()` before the download
was cancelled by the existing whole-test timeout. The other four repeats passed all 138 cases each.
These fixtures have no connections, so the changed connection geometry is not exercised.

A clean `3e4b9305018249be40eefafc47ce2d043ccbdd03` checkout inside the workspace ran only
`annotations.spec.ts`, twice with four workers/four CPUs: 108 passed, zero failed or flaky.
This did not reproduce the two timeouts and is not proof that they predate P2-B.

The single allowed scoped retry uses the unchanged annotation spec, five times with eight workers/eight
CPUs: 270 passed, zero failed or flaky. Keep the original timeouts, assertions and budgets; investigate download completion and filesystem
contention if CI reproduces this failure. The original run's reports are in `tests/.output/g/rwF2Ak6/`.

## Gate evidence

Original neighbour run:

```text
SUMMARY: 3e4b9305018249be40eefafc47ce2d043ccbdd03 | unit="not run" parity="not run" e2e={"passed":688,"failed":2,"flaky":0,"skipped":0} gate_failures=1
```

Clean master, affected spec only:

```text
SUMMARY: 3e4b9305018249be40eefafc47ce2d043ccbdd03 | unit="not run" parity="not run" e2e={"passed":108,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

P2-B's single scoped retry:

```text
SUMMARY: 3e4b9305018249be40eefafc47ce2d043ccbdd03 | unit="not run" parity="not run" e2e={"passed":270,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```
