## Full-run download and slow-motion failures

The full Linux gate on `52c990bc69ef5a39277ec5ea1b3aa6eea9fe09fb`, with twelve workers/CPUs,
completed all 1,996 browser cases with two failures and zero flakes. Static checks, unit coverage,
production build, size and all 2,869 parity goldens passed.

- `private-diagrams.spec.ts`: “an exported private diagram says so, and importing it again keeps it
  private” timed out in its second JSON `download.saveAs()`. The download ended as `canceled` when the
  context closed. This resembles the already recorded export stalls in
  `2026-10-21-export-fallback-download-cancellations.md`; the trace does not establish their cause.
- `slowmo.spec.ts`: “an open Inputs panel and capacity Apply fix wait until slow motion ends” expected
  `live-play` state `slowmo`, but it remained disabled and `paused`.

Neither the download nor slow-motion implementation, assertion, timeout or worker limit was changed to
hide these failures. The earlier stale agent expectation of ten Checks was corrected to thirteen and
passed in the complete run.

## Scoped control and verification budget

A fresh clean `origin/master` copy at `61957d3a66db575f38e85589ab4a24c37409b025` ran **only these two
specs**, twice, in the pinned Linux image with twelve workers/CPUs. All 80 cases passed. This does **not**
establish that either full-run failure predates this feature.

Master advanced during verification to Sampling accuracy 3/9 (#228). The feature branch was synced
onto it. The same scoped replay on rebased `1740663d5a8ff9f7fcb623a03afb7055f547c92c` exited **75** before
testing because another gate held capacity. Per the verification-budget/busy-gate rule, no further full
suite or clean-master suite was queued; delivery records the failure and both control outcomes for CI.
The clean control lives only in ignored test output inside this worktree.

After syncing, the production build and unchanged size budgets passed again. The targeted Check,
worker, fix-agreement, thread-metric, agent-schema, skill and startup-chunk tests passed: 472 tests
across 24 files, with no type errors.

```text
SUMMARY: 52c990bc69ef5a39277ec5ea1b3aa6eea9fe09fb | unit={"passed":13649,"failed":0,"skipped":8} parity={"goldens":2869,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":1994,"failed":2,"flaky":0,"skipped":0} gate_failures=1
SUMMARY: 61957d3a66db575f38e85589ab4a24c37409b025 | unit="not run" parity="not run" e2e={"passed":80,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

## Follow-up

Use CI's reports to investigate browser download completion under the complete workload and the
slow-motion script/loading transition with an open Inputs panel. Preserve the download/content,
mode, focus and timing assertions. Keep this evidence separate from any claim of a proven pre-existing
failure; neither scoped control reproduced it.
