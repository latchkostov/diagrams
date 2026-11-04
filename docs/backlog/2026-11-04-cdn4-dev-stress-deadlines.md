## Linux Dev stress deadlines

The CDN PR 4 verification initially reused the timing-stress settings (eight
workers on eight CPUs) for the complete Linux Dev suite. The gate's normal
resource calculation recommends six workers for an eight-CPU container, matching
CI's three workers per four CPUs. Complete gates use that recommended ratio;
the required affected-UI stress run remains eight workers on eight CPUs and
passed all 1,355 tests across five repeats.

The complete stress run at `350df9b6d229b805c17cf90a1308bad390513e03` reported:

```text
SUMMARY: 350df9b6d229b805c17cf90a1308bad390513e03 | unit="not run" parity="not run" e2e={"passed":3371,"failed":11,"flaky":0,"skipped":56} gate_failures=1
```

Only the eight failing spec files were then replayed twice on a clean Linux
archive of origin/master `eabab979103061adf6dcbc9ca43bff3552d4925b`, using the
same eight-worker/eight-CPU settings. No checkout or other worktree changed.

```text
SUMMARY: eabab979103061adf6dcbc9ca43bff3552d4925b | unit="not run" parity="not run" e2e={"passed":269,"failed":15,"flaky":0,"skipped":0} gate_failures=2
```

## Reproduced on master

| Case                                                                           | Master failures / two runs |
| ------------------------------------------------------------------------------ | -------------------------- |
| `inspector-layout.spec.ts:172`, 1440px en-XA segmented labels                  | 2 / 2                      |
| `inspector-layout.spec.ts:172`, 1440px Arabic segmented labels                 | 2 / 2                      |
| `keep-camera.spec.ts:264`, visible narration subject at 0px                    | 2 / 2                      |
| `keep-camera.spec.ts:264`, visible narration subject at 10px                   | 2 / 2                      |
| `keep-camera.spec.ts:264`, visible narration subject at 100px                  | 2 / 2                      |
| `sharing-privacy.spec.ts:225`, refusal export action after opening the gallery | 1 / 2                      |

The inspector cases time out in selection settling; the Follow cases time out
waiting for camera idle; the gallery case loses its toast action. Master also
failed the related 1280px segmented-label cases (en-XA twice, English and Arabic
once each), which passed in the feature's complete stress run.

Five other initial failures did not reproduce in the prescribed master replay:
the skill ZIP download, collaboration raster export, big-import toast, phone
transport loading/Retry and the held Live pan frame. This record does not classify
those five as pre-existing.

## Follow-up

Investigate readiness and real-clock sensitivity under whole-suite CPU stress
without changing camera behavior, fixture sizes, assertions or deadlines. Keep
the normal full-gate CPU/worker ratio and the separately required higher-load
UI repeats explicit in verification reports. No assertion, timeout, bundle/checkpoint limit or
quarantine was changed for this investigation.

Local evidence: `tests/.output/cdn4-linux-dev.log` and
`tests/.output/cdn4-master-dev.log`; reports `g/r61C1d9` and `g/master-QkKxMQ`.

## Focused feature comparison

The identical 142-test workload repeated twice on the feature reported:

```text
SUMMARY: 350df9b6d229b805c17cf90a1308bad390513e03 | unit="not run" parity="not run" e2e={"passed":269,"failed":15,"flaky":0,"skipped":0} gate_failures=2
```

The five unclassified full-suite cases passed its first pass; the ZIP case timed
out in its second. The isolated-editors collaboration case also timed out twice
on the feature and passed on master. These are not claimed as master-proven
failures. Both correctly resourced complete gates remain required before the PR.
