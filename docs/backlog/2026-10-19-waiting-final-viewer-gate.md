## Static viewer failures in the waiting final full gate

The one full Linux gate on the final implementation used 12 workers and 12 CPUs. All static checks, 12,043 unit tests, production/profile builds, startup and viewer size budgets, and all 2,712 parity goldens passed. All waiting-request, Live, Watch together and annotation cases passed. Eight cases in `viewer-bundle.spec.ts` failed:

- Both static Forge CSP loads (free play and saved simulation): the rendered node stayed hidden.
- Cached pagehide/pageshow and keyboard zoom/pan/fit: the rendered node stayed hidden.
- Both host-play cases (free play and saved simulation), Live reading-region arrow keys, and Live export/recording: the Live play control did not appear.

```text
SUMMARY: 73eb335c6e62ad2ce3783ed1be02154e527f1b32 | unit={"passed":12043,"failed":0,"skipped":4} parity={"goldens":2712,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":1786,"failed":8,"flaky":0,"skipped":0} gate_failures=1
```

## Focused comparison

Only the affected viewer spec ran on clean `origin/master`, once with two Linux repetitions, 12 workers and 12 CPUs. The feature branch then ran that same focused comparison. Both had the same single failure: `viewer-bundle.spec.ts:232`, arrow keys scrolling Live reading regions, waiting for the paused Live play control. One repetition passed all nine cases on each branch. No assertions or timeouts changed.

```text
SUMMARY: e89c744631ff33978748dd256f95cd6b4f917ae9 | unit="not run" parity="not run" e2e={"passed":17,"failed":1,"flaky":0,"skipped":0} gate_failures=1
SUMMARY: 73eb335c6e62ad2ce3783ed1be02154e527f1b32 | unit="not run" parity="not run" e2e={"passed":17,"failed":1,"flaky":0,"skipped":0} gate_failures=1
```

The scrolling failure reproduces on clean master. The seven other full-run failures do not reproduce in either focused comparison, so their pre-existing status is **not established**. Investigate viewer readiness and full-run interference separately. Under the verification-budget instruction, record these results and push rather than repeat full suites; the follow-up commit changes only this evidence fragment. The full gate is red and has no verification stamp.

The separate [annotation load evidence](2026-10-19-waiting-final-annotation-load.md) remains unresolved despite every annotation case passing in the full gate.
