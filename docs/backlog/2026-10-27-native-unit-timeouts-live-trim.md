## Native unit backstops under concurrent local load

During the Live/canvas trim, `pnpm test --maxWorkers 2` hit the existing 5,000 ms hang backstop in unrelated simulation, tutorial, importer and collaboration tests. Do not increase timeouts or change assertions to hide these failures.

The following failures reproduce on an immutable, tracked-only archive of clean origin/master `96fdfef624bb61710806546ef2e7395f3c3134f2`, inside this checkout, with the same Node 24 runtime and installed dependency lock. Only affected specs/cases were rerun; no clean-master full suite was run.

- `src/tutorials/completionSweep.test.ts`: the threads-block/no-threads-waiting Skip-from-completing case, retry-storm reading the caller, and backoff-budget jitter. Both clean-master checks fail all three at the same timeout backstop.
- `src/collab/recovery.test.ts`: merging another tab's encrypted journal without rereading its 5,000-node checkpoint. Both clean-master checks fail at the same timeout backstop.
- `src/interop/infra/pick.test.ts`: restoring exhausted KEDA scaling by retrying the same fitting boundary. Both clean-master checks fail at the same timeout backstop.
- `src/sim/cpuTail.test.ts`: saturated CPU at scale 1.1. Both focused clean-master checks fail at the same timeout backstop; a broader affected-spec check also reproduces the scale-one sampled-CPU failure.

Evidence: the first clean-master pair reports `Tests 4 failed | 229 passed | 1677 skipped (1910)` on both runs; the importer/epochs pair reports `Tests 1 failed | 1 passed | 47 skipped (49)` on both runs; the focused CPU pair reports `Tests 1 failed | 1 passed | 28 skipped (30)` on both runs. The epochs case passes these focused checks, so its broad-run timeout is not established as a reproducible master failure by that evidence.

Local reports are retained under `tests/.output/live-trim-baseline/trim-master-*.log`; broader results and any remaining unconfirmed failures are reported honestly in the trim PR. Investigate the native backstops with isolated worker capacity and same-run workload baselines, rather than weakening tests. The affected E2E gate also exited 75 because the shared worker budget was occupied; that run emitted no SUMMARY and ran no browser tests.
