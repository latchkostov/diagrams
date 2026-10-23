## Investigate the inspector test duration under parallel Linux load

The hover-card fix round at `46372db5e75a9629255c6076dce3dd5c02908536` ran the naming, simulation-truth, hover-card, Live and inspector specs five times with five workers and four CPUs. The result was 529 passed, one failed and zero flaky. The sole failure was `inspector.spec.ts:6` in repetition 2: its assertions completed, then the overall 30-second test timeout fired during teardown. Repetitions 1, 3, 4 and 5 passed. Both original CI regressions and every hover-card test passed all five repetitions.

A clean `origin/master` checkout at `dd389319082e1084bd82fc491883593851585457`, running only the inspector spec twice with the same worker and CPU declarations, passed all four checks. This does not establish that the timeout predates the hover redesign; the isolated run also has less concurrent browser work. Preserve the assertions and timeout, and compare the inspector trace under equivalent parallel workload before changing behavior.

## Evidence

Feature gate: `tests/.output/g/rcR99Ju`, with the failing trace retained locally as `tests/.output/hover-inspector-final.zip`. Clean-master summary:

```text
SUMMARY: dd389319082e1084bd82fc491883593851585457 | unit="not run" parity="not run" e2e={"passed":4,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```
