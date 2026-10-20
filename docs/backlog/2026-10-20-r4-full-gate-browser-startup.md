## Full-gate browser failures observed during the R4 review

The engine regressions, full unit coverage, static checks, production builds, size and both parity
tiers pass. A Linux full gate at `6df337ac3df1ce042fe3d26a6be211dc1583c951` nevertheless reports 16
browser failures across these specs:

- `slowmo.spec.ts`: Inputs open while starting slow motion remains paused.
- `skill-html.spec.ts`: the animation-clock-origin playback check times out.
- `viewer-bundle.spec.ts`: eight startup/visibility and host-play cases.
- `live-record-capture.spec.ts`: four cases cannot find Live controls.
- `ai-privacy.spec.ts`: import/Duplicate metadata after reload.
- `image-slices.spec.ts`: the 300-node PNG byte-parity case.

The first gate explicitly used 12 workers / 12 CPUs, despite the Linux VM's 31.2 GiB memory yielding
10 workers under the documented memory-based recommendation. This is a configuration observation,
not proof that memory pressure caused the failures. Assertions, timeouts and goldens were not relaxed.

## Bounded master comparison

A clean, isolated checkout of origin/master `5dfc39bf42442ab5fe62c8043fbd8aa3d07368ee` ran exactly
those six specs in Linux with 12 workers / 12 CPUs and two repeats. Both repeats passed: 74 each,
148 total. This does **not** establish the failures as pre-existing, nor recreate the whole-run history.
No full master suite was run.

The branch was then synced onto that server/deployment-only master update. Simulator, model and
stencil source remained byte-identical to the first gate and sweep. A full-gate attempt on the
rebased implementation (`967ed8937cd851e39e73346a1561112248aea7f3`) with 10 workers / 10 CPUs and
29 GiB memory exited 75: another full gate held all 12 shared slots. The busy-gate policy delegates
the final full run to PR CI.

## Exact summaries

```text
SUMMARY: 6df337ac3df1ce042fe3d26a6be211dc1583c951 | unit={"passed":12884,"failed":0,"skipped":4} parity={"goldens":2712,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":1805,"failed":16,"flaky":0,"skipped":0} gate_failures=1
SUMMARY: 5dfc39bf42442ab5fe62c8043fbd8aa3d07368ee | unit="not run" parity="not run" e2e={"passed":148,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

The busy rebased attempt produced no SUMMARY line and no verification stamp.

## Follow-up

Use PR CI and, if needed, the retained full-gate traces to isolate whole-run browser startup/clock
state or load. Reproduce on the implementation and base with a bounded workload and the documented
worker budget. Keep visibility, clock, pixel parity and privacy assertions unchanged; do not raise
absolute timeouts or re-record goldens to hide a failure. No production fix is claimed for these
browser failures in the R4 accounting changes.
