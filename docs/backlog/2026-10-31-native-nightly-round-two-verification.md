## Local verification

Node 24.22.0, native Windows Chromium; Linux Playwright's pinned image. Production E2E ports were explicit. Every server started by these runs was managed by Playwright or the gate and stopped at completion. Each implementation cause has its own signed commit, synchronized with master and pushed after its checks.

| Cause                      | Windows evidence                                                                                                             | Linux verification                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Interrupted reporting      | Killed-process regression fails without inventory; final lifecycle coverage passes                                           | 23 reporter units pass                                                                   |
| Native select experiment   | Four affected cases, two repetitions: 8 pass; experiment subsequently rejected                                               | 8 pass, two repetitions; original tests restored                                         |
| Requested Live tutorial    | Held-session regression fails without readiness; affected cohort: 10 pass                                                    | Complete tutorial and peer cohort: 468 pass, two repetitions                             |
| macOS candidate experiment | Both isolated candidate modes deliver a real message on Windows; five launch units pass                                      | Peer/tutorial cohort above; macOS evidence comes from branch Nightly                     |
| Capture launch inheritance | Actual browser-command regression fails without inherited flags; corrected regression passes twice; 62 other executions pass | Four complete specs: 64 pass, two repetitions                                            |
| Settled inspector geometry | Paused-clock regression measures -355 without the wait; affected cohort: 6 pass                                              | Complete affected specs: 54 pass; neighbour load cohort: 45 pass across five repetitions |
| Real verification replies  | Held-worker regression fails without the wait; six probe units and 10 affected executions pass                               | 38 pass across two repetitions; six units pass                                           |
| Deferred timeline          | Held-chunk regression fails before the fix and with it temporarily reverted; 4 affected executions pass                      | Complete spec: 16 pass across two repetitions                                            |

No new skips or quarantines, deadline or budget increases, weakened assertions, tolerance changes or golden updates. A final independent Windows probe retains the compact-layout width, worker throughput and low-zoom stop/resume assertions: **8 passed**, two repetitions across four cases. This does not prove an intermittent native-runner failure is fixed.

The final transfer repair's real-worker ownership regression fails when empty-list forwarding is temporarily reinstated. The complete review spec then passes twice on Windows: **12 passed**. The shared probe's six units also pass. Its Linux verification includes the complete review, owner and lazy-fix specs together; that gate's exact summary is reported in the PR.

The targeted build/reserve gate completes with:

```text
SUMMARY: c5b57e6bce2bdb1cb07fdba6a224dde33f735538 | unit={"passed":64,"failed":0,"skipped":0} parity={"goldens":3178,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":0,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

Build and size pass in the same gate. The transfer-only observer changes made during that run are covered again by the probe unit and E2E gate; application build inputs and outputs are unchanged.

## Failed attempts and their resolution

Two tutorial gate invocations selected stale line numbers and found no tests; the subsequent complete tutorial spec passed in the 468-execution cohort. A following gate attempt returned busy (75), so the commit was pushed as instructed. A native peer probe overlapped a Linux build writing the same prebuilt directory and failed on missing hashed chunks; a serialized rerun passed 18 cases. Two initial browser-command probes lacked Chromium's diagnostic automation switch; the scoped corrected regression passed twice. The first new verifier regression evaluated during navigation, then its cleanup waited on an unreleased request; moving that observation after visible paused-clock readiness produced the passing 38-execution Linux run. These attempts are not claimed as green cohorts.

## Native runner authority

Ready PR [#403](https://github.com/latchkostov/diagrams/pull/403). The first branch Nightly [41182626886](https://github.com/latchkostov/diagrams/actions/runs/41182626886) tests code commit `c5b57e6bc`, before the final verification-transfer repair. It was cancelled after newer code was pushed; its partial reports and diagnostic are evidence, not a completed green run. The final branch dispatch, tested SHA, per-OS shard table and remaining failure groups are reported in the PR and task handoff. The baseline inventory and persistence comparison are in `2026-10-31-native-nightly-inventory.md`; the missing 16 macOS results were unfinished after the unchanged step deadline, not intentional skips.

## Completed intermediate branch run

[41183332686](https://github.com/latchkostov/diagrams/actions/runs/41183332686) tests `0187ee291`, after required synchronization brought in master #402's new keyboard tutorials, but before the requested-Live, planner and fixture follow-ups. It is red, not a successful final verification.

| OS      | Green shards | Red shards | Passed | Failed | Existing skips | Named unfinished |
| ------- | -----------: | ---------: | -----: | -----: | -------------: | ---------------: |
| Windows |            2 |          6 |   3025 |     21 |             15 |               44 |
| macOS   |            4 |          8 |   3029 |     49 |             11 |               16 |

All 60 unfinished identities are preserved, including started/not-started state, in the uploaded native reports. The macOS peer group has no remaining failures. The native select and Control-drag decisions remain open and assertions remain enabled. Of the 39 new macOS keyboard failures, 34 stop at the native-popup close boundary; the remaining five require separate investigation.

Additional remaining groups in that run are Windows capacity/inspector readiness, documentation-tooltip and firewall selection, worker frame/particle observations, live/replay controls and tutorial predicates; macOS has bend-carry cancellation, entry-point Undo, copy-notice geometry and syllabus contrast. These are unresolved observations, not declared platform impossibilities or proven pre-existing failures. Detailed titles are retained in the run's native reports. The planner fixture and held-Live regression were repaired in later commits; their native evidence is in the corresponding fragments and final dispatch.

The attempted clean-master keyboard comparison ran only that spec with two repeats in this same worktree. The shared gate returned **busy (75)**, so no master pass/fail claim is made and no live lock was removed. The branch was restored and remains pushed. Per the verification-budget rule, this does not block pushing; native CI remains the authority.
