## Live details readiness scope

The browser test driver now opts into post-focus camera and viewport settlement only in the
latency cases that need it. Ordinary Live details retain their existing card-placement wait,
including when unrelated camera or pane work stays pending or the page clock is paused.
This fixes the planning hover/focus regression introduced by the shared readiness wait.

The latency readiness controls still cover pending, animating and idle cameras, with the same
pinning and movement assertions. A new control holds both unrelated global markers pending
and requires the ordinary driver to pin and open its requested section successfully.

Application output is unchanged; no parity golden changes.

## Verification

Linux, six workers/three CPUs: planning-p1, latency and latency-readiness pass all three
repetitions (**93 passed, 0 failed, 0 flaky**). The new pending-work control fails when
the unconditional wait is temporarily restored (`pending` instead of `idle`), and passes
with the scoped wait.

All direct caller specs, plus both indirect lazy-surface caller specs, pass on Linux at four
workers/four CPUs: **292 passed, 0 failed, 0 flaky**.

Latency scrolling stress, Linux six workers/three CPUs, `--repeat-each 30`: **60 passed,
0 failed, 0 flaky** (presentation 30/30; embed 30/30). No assertion, timeout or retry changes.

Exact quick-gate summaries (the starting HEAD identifies the working-tree runs):

```text
SUMMARY: 94fbdf87d2cae6ad0d54830c090e41e271719ace | unit="not run" parity="not run" e2e={"passed":93,"failed":0,"flaky":0,"skipped":0} gate_failures=0
SUMMARY: 94fbdf87d2cae6ad0d54830c090e41e271719ace | unit="not run" parity="not run" e2e={"passed":292,"failed":0,"flaky":0,"skipped":0} gate_failures=0
SUMMARY: 94fbdf87d2cae6ad0d54830c090e41e271719ace | unit="not run" parity="not run" e2e={"passed":60,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

Only the targeted fix-round browser checks were run; unit and parity suites were not rerun.
