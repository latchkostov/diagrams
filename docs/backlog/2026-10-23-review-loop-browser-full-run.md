## Native full-run browser failures during review-loop verification

The single full native gate on code commit `af59a964bb9c3926d45eec37eb79a9bab1e76d54` passed
static checks, unit coverage, build, size, all 3,146 parity goldens and self-host smoke, but failed
14 Chromium cases. These are **not confirmed clean-master reproductions**: both targeted repeats
on clean `origin/master` at `d8850ec5ff09d93e773c8af365ae716df716d443` passed all 82 cases.
Record these as full-run-only failures pending investigation, rather than claiming a green full gate.

- Ten cases in `hover-cards.spec.ts` and `hover-stacking.spec.ts` timed out tearing down browser contexts.
- `lazy-live-fixes.spec.ts:335` expected playing but observed done.
- `planning-p3.spec.ts:199` did not find the translated rejection event.
- `share-chooser.spec.ts:296` failed navigation with `net::ERR_ADDRESS_IN_USE`.
- `ux-resilience-followup.spec.ts:66` observed zero roving timeline tab stops instead of one.

The only changed file under `src/` is the review-loop unit test; no application implementation or
E2E assertions were changed. Per the verification budget, compare only the failing specs once with
two repeats and retain the outcome for CI, without repeating a full suite or loosening assertions.

Clean-master comparison (ordinary disposable clone inside the current worktree's ignored test outputs):

```sh
pnpm gate quick tests/e2e/hover-cards.spec.ts tests/e2e/hover-stacking.spec.ts tests/e2e/lazy-live-fixes.spec.ts tests/e2e/planning-p3.spec.ts tests/e2e/share-chooser.spec.ts tests/e2e/ux-resilience-followup.spec.ts --only e2e --repeat 2 --workers 12 --max-wait 1
```

```text
SUMMARY: af59a964bb9c3926d45eec37eb79a9bab1e76d54 | unit={"passed":15353,"failed":0,"skipped":10} parity={"goldens":3146,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":2167,"failed":14,"flaky":0,"skipped":4} gate_failures=1
SUMMARY: d8850ec5ff09d93e773c8af365ae716df716d443 | unit="not run" parity="not run" e2e={"passed":164,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

Artifacts: `tests/.output/g/r1KLm6j` and
`tests/.output/review-master-baseline/tests/.output/g/rNO4vY6`. Browser/test-infrastructure follow-up:
investigate full-run Windows context teardown, connection exhaustion and clock-sensitive Live assertions
using these traces. No assertion was relaxed, test quarantined or product behavior changed here.
