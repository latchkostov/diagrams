## Interruption diagnosis

Nightly [41413744689](https://github.com/latchkostov/diagrams/actions/runs/41413744689), macOS
shard 7, reaches the existing 25-minute E2E step limit. It completes 281 of 285 tests without a
test failure. Their durations total 1,430.072 seconds; the longest completed test takes 24.807
seconds. Checks' 1,500-node typing stress case is running at interruption. Relay sharing and
both dev StrictMode Checks mount cases have not started. This is a shard deadline, not evidence
that those three unstarted cases hang.

The earlier round-9 dispatch, 41406762649, records this same long-run typing case passing in
macOS shard 12 (16.561 seconds). That is a completed native observation, not a claim that an
intermittent hang is impossible. Together with the later step-deadline log and cumulative work,
it supports balancing the interrupted shard rather than changing the stress case or its limit.

## Native measurements without changing Linux

`E2E_TIMINGS=tests/e2e-timings-macos.json` selects a separate measured profile in the existing
planner and updater. Nightly sets it only for macOS's E2E step. An explicit missing file fails
early; ordinary Linux planning keeps the existing file and behavior. The two profile regressions
fail with the original updater temporarily restored. The restored harness cohort passes 40 units.

The profile comes from the native-count artifacts in runs 41406762649 and 41413744689, not from
their trace bundles or partial checkpoints. Download only `nightly-results-native-e2e-macos-*`
from each run, then set `E2E_TIMINGS` and run `node scripts/e2e-shard.mjs --update <directories>`.
The updater finds `native-results.json`, unwraps each child and ignores interrupted reports.
It records 204 measured files from 23 complete reports; new/unmeasured files use the existing
mean estimate. No partial measurement is treated as a complete file cost.

Using the same native costs and fallback on both plans at the profile commit, the largest old twelve-shard
assignment is estimated at 1,341.9 seconds; the largest native-weighted assignment at 1,121.1
(ratio 0.835). Every spec remains assigned exactly once. These estimates require a dispatched
Nightly to establish whether all four formerly interrupted cases now finish.

## Local verification

The final Linux subset passes 45 harness/fragment units and 128 browser executions, including
four Dev executions, with zero failures or flakes. The long-run Checks typing case, relay sharing
and both StrictMode Checks mount cases each finish in both repeats. Their source and limits are
unchanged. This validates the local cases, not the hosted macOS deadline; that requires the branch
Nightly. Application bytes retain the preceding full parity result: all 3,178 goldens unchanged.

```text
SUMMARY: 1cacd30fb0461d7dbf3e68f4475bd13f176d339e | unit={"passed":45,"failed":0,"skipped":0} parity="not run" e2e={"passed":128,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

The quick gate runs working edits on its starting HEAD, not a committed-head stamp.

## Hosted outcome

Branch Nightly [41450369467](https://github.com/latchkostov/diagrams/actions/runs/41450369467)
tests integration `8d4ec6548`, including #424 and #425. All twelve macOS steps finish within
their unchanged 25-minute limit; the longest takes 22 minutes. All four formerly unfinished
cases pass: Checks typing 17.207 seconds, relay sharing 2.633 seconds, and the two Dev StrictMode
mount cases 3.964/2.320 seconds. macOS has zero unfinished cases or interrupted reports.

This resolves the observed cumulative shard interruption. Seven native test failures remain
enabled and distinct from that interruption; the [results fragment](2026-11-02-native-nightly-round-ten-results.md)
records every remaining group and the complete per-OS table. No hang is inferred for the three
previously unstarted cases, and no blanket claim about future intermittent hangs is made.
