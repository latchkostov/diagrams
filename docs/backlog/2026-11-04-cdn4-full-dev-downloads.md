## Full Dev SVG downloads and palette lookup

The complete Linux Dev run on `cd4c3d40e6b95ccf15fa809e643eee97210a2943`
used six workers and eight CPUs, matching the gate's recommended ratio. It
finished with:

```text
SUMMARY: cd4c3d40e6b95ccf15fa809e643eee97210a2943 | unit="not run" parity="not run" e2e={"passed":3377,"failed":5,"flaky":0,"skipped":56} gate_failures=1
```

Four `lazy-surfaces.spec.ts:174` cases timed out after the SVG download event:
`live.capacity-analysis`, `live.threads`, `live.session` and `live.calls`.
Their `download.path()` calls remained pending until test teardown canceled
the downloads. The fifth failure, `round13-polish.spec.ts:171`, could not find
the Redis cache stencil command after typing into the command palette.

## Focused comparison

Only those two spec files were replayed twice, with the same six-worker,
eight-CPU Dev settings. The clean master comparison used `git archive`,
without changing the working tree. Both comparisons passed:

```text
SUMMARY: 0a72f0cfb99090c52e2dd8cbe25c753b9c7347c4 | unit="not run" parity="not run" e2e={"passed":152,"failed":0,"flaky":0,"skipped":0} gate_failures=0
SUMMARY: cd4c3d40e6b95ccf15fa809e643eee97210a2943 | unit="not run" parity="not run" e2e={"passed":152,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

These five failures remain unclassified. The focused passes do not replace
the complete run or prove a pre-existing failure. No timeout, assertion,
quarantine or worker recommendation was changed. Investigate the full-run
download completion and command-palette readiness if CI reproduces them.

Local evidence is retained under `tests/.output/`: `cdn4-linux-dev-normal.log`,
`cdn4-master-dev-normal.log` and `cdn4-head-dev-normal-targeted.log`. The full
run's traces and screenshots are in `g/rpuRcYc/e1/`.
