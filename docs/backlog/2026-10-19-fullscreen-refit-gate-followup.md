## Fullscreen pane-squeeze failure under full-gate load

Engine R3's single Linux full gate, with eight workers and eight CPUs, failed only
`present.spec.ts:265`, "going full screen and back refits a diagram shown whole to the pane".
At line 283, after the second pane squeeze to 50%, the test expected clipped nodes but found none.
All 1,808 other browser cases passed, with zero flakes. Unit coverage, static checks, builds,
bundle size and all 2,712 parity goldens passed.

The test enters presentation from editing without starting Live. R3 does not change camera or
presentation code. A separate clean checkout of origin/master at
`e659ec3372e6b0593fba3913e69aa960917d91d5` ran only `present.spec.ts` in Linux, with four workers,
four CPUs and `--repeat 2`: both repetitions passed, 14 cases each. The failure was **not
reproduced**, so it is not established as a pre-existing failure. The task's verification-budget
rule calls for recording this single-spec baseline result and continuing to push.

No assertion, tolerance or timeout changed. Follow up by inspecting the camera journal around
the first fullscreen fit and second pane squeeze under load; establish whether the refit timing
or the clipping premise is wrong before changing behavior or an assertion.

Full gate on the engine commit (the later amendment adds only this record):

```text
SUMMARY: 8ddf0e869342efab09663e77e322635ffa29f438 | unit={"passed":12634,"failed":0,"skipped":4} parity={"goldens":2712,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":1808,"failed":1,"flaky":0,"skipped":0} gate_failures=1
```

Clean-master targeted baseline:

```text
SUMMARY: e659ec3372e6b0593fba3913e69aa960917d91d5 | unit="not run" parity="not run" e2e={"passed":28,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```
