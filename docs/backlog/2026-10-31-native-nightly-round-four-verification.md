## Accepted baseline and unfinished tests

Completed Nightly [41245495563](https://github.com/latchkostov/diagrams/actions/runs/41245495563), source db7322cdb9621f8af0623dab095e8d18988ff57f, has exactly the same Git tree as starting master f843d13ac: 3a2ebcd9ae48f1bebef3e4f2bbf0e1bf891aaa72. It supersedes round three's earlier incomplete numbers.

| OS/mode                        | Passed | Failed | Existing skips | Unfinished |
| ------------------------------ | -----: | -----: | -------------: | ---------: |
| Windows                        |   3200 |     17 |             15 |          0 |
| macOS                          |   3210 |     11 |             11 |          0 |
| Linux Dev                      |   3180 |      2 |             50 |          0 |
| Linux Build, three repetitions |   9477 |      0 |             33 |        186 |

Windows and macOS finish their complete inventory. Linux Build shard 1 hits the existing job deadline: 630 completed pointer-tutorial executions alone consume 4,828.747 worker seconds. Four whole-file pointer partitions retain exactly the same 264 discovered project/test identities, including existing quarantine metadata. Measured production weights, with Dev observations only for missing successful production identities, bring the twelve-shard plan to about 1,287 worker seconds per shard. No job or test limit is raised.

## Scoped repairs

- Compound keyboard connections yield when the lesson accepts the edge, before optional port edits can target the next instruction. A broad per-action early exit was rejected: it skipped required Enter/Close actions during completion.
- Keyboard command-palette Live toggles await the requested lazy session mount or completed exit. A held real session download reproduces the early return.
- Consecutive native select typeahead re-enters focus with Tab and Shift+Tab, clearing Chromium's prior typeahead session. Native selections keep exact value assertions; Windows/Linux arrow and popup paths are unchanged.
- Pointer sweeps are partitioned for complete scheduling, with registration and inventory audits. Their original solution and Skip-all actions/assertions are retained.
- Camera contrast capture awaits actual finite canvas animations after the fake JavaScript camera clock settles. Infinite decoration is excluded; colours, fade durations and contrast floors are unchanged.
- Raw keyboard recipe keys respect explicit menu-owned camera deferral. Canvas keys still require camera idle; the menu's Enter/Escape must be able to release its own deferral.
- Latency scrolling acknowledges real wheel/key delivery even at an existing boundary, then native completion. Exact Home/End/page-key assertions are unchanged.
- Boundary copy snapshots use the existing current-document autosave acknowledgement before exact original/copy and Undo/Redo comparisons.

Each behavioral driver repair has a regression that fails with its scoped fix temporarily restored to the previous implementation. Partition discovery is identical before/after; duplicating a partition fails its inventory unit. Per-cause backlog and UX review fragments contain the evidence and rejected alternatives.

## Local verification

Node 24.22.0, native Windows Chromium and the pinned Linux Playwright container, explicit owned ports and declared worker/CPU counts. No full gate or full suite was queued in this fix round.

Application build, startup/reserve heavy tests, size and full output parity pass:

```text
SUMMARY: f843d13ac61333b9270c6668620f1ea06e930dea | unit={"passed":30,"failed":0,"skipped":0} parity={"goldens":3178,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":0,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

All eight changes are confined to browser drivers, test declarations, measured scheduling weights and documentation. Application output is unchanged; no golden is re-recorded. There is no new simulation, planning or stencil feature requiring a showcase example.

Completed Linux cohorts before the final combined checks:

```text
SUMMARY: 3c98bf3d2edcfcdf35cef6677632d6dd4ceb5aff | unit="not run" parity="not run" e2e={"passed":144,"failed":0,"flaky":0,"skipped":0} gate_failures=0
SUMMARY: c2b0df5770099e0c0829c96761e5dabce9b43797 | unit={"passed":27,"failed":0,"skipped":0} parity="not run" e2e={"passed":236,"failed":0,"flaky":0,"skipped":0} gate_failures=0
SUMMARY: 0d223e2a675e84580a71e5ffc12b55242cae6b9b | unit="not run" parity="not run" e2e={"passed":24,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

The first line covers all keyboard lessons, driver regressions and native selects twice. The second covers every moved pointer solution and Skip-all path plus the moved-helper regressions twice. The third covers the complete camera spec twice. The menu/camera contract and keyboard inventory units pass 37 cases. Windows passes 29 group-one/group-four keyboard cases including the menu regression, all five camera cases, 20 final-source latency executions, and six boundary reader/copy executions.

Initial failures are retained as evidence, not counted as green: the broad keyboard completion guard caused five failures in the first 30-execution Linux experiment and was removed; a boundary fixture's first example edit could save immediately and was corrected to hold a second edit after the first explicit save. Lint caught a non-null assertion in the new menu fixture; it was replaced with an explicit missing-owner error. Deliberate temporary reversions fail their new regressions. Busy gate attempts exit 75 without removing locks or waiting for capacity.

The final complete keyboard/native-select cohort and complete latency/boundary specs pass two Linux repetitions:

```text
SUMMARY: 26ba1af45c49ec0625068f7dea3588d5089ffcb4 | unit="not run" parity="not run" e2e={"passed":146,"failed":0,"flaky":0,"skipped":0} gate_failures=0
SUMMARY: 92f06235143cae02b2a9d0a215fca6a6b64e4a63 | unit="not run" parity="not run" e2e={"passed":104,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

Together with the 236 pointer and 24 camera executions, these final affected cohorts pass 510 Linux executions, with zero failures or flakes. Final lint, `pnpm typecheck`, `pnpm format:check` and `pnpm exec prettier --check .` run after the final edit before the signed commit. Lint retains 11 existing warnings and no errors. The ready PR records the final native dispatch separately.

## Native dispatch and remaining evidence

Diagnostic [41249763740](https://github.com/latchkostov/diagrams/actions/runs/41249763740), source 6452c5b35, contains only the first compound-connection repair. Windows completes with 3,193 passed, 25 failed, 15 existing skips and zero unfinished. It is red and does not verify the later changes.

The ready PR links the final-head Nightly dispatch, its exact per-OS passed/failed/unfinished counts and remaining failure groups. Native confirmation is distinct from the local regressions; no unconfirmed native failure is declared fixed or proven to pre-exist on clean master.

Renderer throughput, recording pixels/captions, native geometry, confirmations and remaining replay observations stay enabled unless their final native evidence clears them. The worker failure's exact zoom is 0.6037, above the calm-tier threshold; a speculative zoom adjustment was rejected. Routing's queued candidate is green in the accepted baseline and is not changed without a reproduction. No server, TURN or tracker change, new skip/quarantine, retry, timeout, tolerance or budget increase is introduced. Commits are signed and pushed separately by normal fast-forward; no other worktree is changed or branch history rewritten.
