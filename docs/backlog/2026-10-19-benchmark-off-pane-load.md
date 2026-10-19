## Benchmark off-pane setup under full-gate load

The single full Linux gate for the Follow-ups 13 review fixes failed the unchanged
`bench-harness.spec.ts` test “benchmark fits an off-pane card through the app before clicking it”.
`Bench.emptySpot()` threw “no empty spot on the canvas” at `tests/bench/ui/harness.ts:359`.
The review fixes do not change this pointer/benchmark path or its test.

To bound verification after the known failure, the remaining browser work was interrupted. All static
checks, 12,609 unit tests (4 skipped), production builds, bundle budgets and 2,712 parity goldens passed.
The browser run finished with 678 passed, 1 failed, 12 interrupted and 1,124 not run. The summary counts
the latter two groups as 1,136 skipped; this is not a successful full gate.

The required one-off comparison ran only `bench-harness.spec.ts` twice on clean `origin/master`
at `e659ec3372e6b0593fba3913e69aa960917d91d5`, with 12 Linux workers and CPUs. Both runs passed
(6 tests total), so the failure is not proven to reproduce on master. Keep the assertion and setup
unchanged for this four-fix review round; investigate the empty-spot setup under broader load separately.

## Verification summaries

The implementation tested below is unchanged; the later commit adds verification documentation only.

```text
SUMMARY: 95cf09e99c098bc533b84aa3b4c540f0378b8525 | unit={"passed":12609,"failed":0,"skipped":4} parity={"goldens":2712,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":678,"failed":1,"flaky":0,"skipped":1136} gate_failures=1
SUMMARY: e659ec3372e6b0593fba3913e69aa960917d91d5 | unit="not run" parity="not run" e2e={"passed":6,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```
