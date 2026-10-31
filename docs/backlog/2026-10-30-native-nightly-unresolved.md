## Branch Nightly remains red

[Nightly 41150389073](https://github.com/latchkostov/diagrams/actions/runs/41150389073) tests signed product commit be23c8e323feda3b6f1fae93800b172debe5a997 from [PR #397](https://github.com/latchkostov/diagrams/pull/397). All eight Windows native jobs fail: 2,954 passed, 41 failed, 0 flaky, 15 existing skips. The verified fixes do not establish that every native failure is resolved. Original and current-master inventories remain in [the initial triage](2026-10-30-native-nightly-e2e.md).

| Windows shard | Passed | Failed | Existing skips |
| ------------- | -----: | -----: | -------------: |
| 1/8           |    281 |     19 |              0 |
| 2/8           |    292 |      3 |              0 |
| 3/8           |    445 |      3 |              0 |
| 4/8           |    409 |      1 |             15 |
| 5/8           |    294 |      4 |              0 |
| 6/8           |    458 |      6 |              0 |
| 7/8           |    362 |      4 |              0 |
| 8/8           |    413 |      1 |              0 |

The full Windows shard-5 and macOS shard-8 reports confirm all 18 bundle-trim cases pass, including the two formerly failing quick-add navigation paths, the held metadata handoffs and library Enter. Windows shard 1 passes the exact rate-limit endpoint regression and the original boundaries, dependencies, arrange, fanout, timeouts-pools, load-shedding and dead-letters solution cases. This is evidence for those fixes, not for unrelated readiness failures.

The final macOS job results and links are recorded in the PR as the queued jobs complete. macOS shard 8 completes with 313 passed and no failures or flakes. Shard 10 is interrupted: its checkpoint records 259 passed and 14 failed, with only 273 of 292 expected cases completed. Its remaining 19 cases are unknown, not passes or intentional skips.

## Native Windows comparison

The branch's first eleven newly failed locations were replayed twice with the owning PowerShell process restricted to four CPUs, matching Nightly's available CPU count, and three workers. All 36 selected executions pass:

```text
SUMMARY: be23c8e323feda3b6f1fae93800b172debe5a997 | unit="not run" parity="not run" e2e={"passed":36,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

One clean-master Windows comparison then selected all failed locations, twice, with the same CPU affinity and worker count. Generated and parameterized sibling cases are included by line selection. The same worktree was clean and detached at 9b3e8b2b296cfacfbd1c67017d8d4a780c4d2970, then restored to the fix branch in the helper's finally block. Every execution passes:

```text
SUMMARY: 9b3e8b2b296cfacfbd1c67017d8d4a780c4d2970 | unit="not run" parity="not run" e2e={"passed":280,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

Consequently these branch Nightly failures are not proven pre-existing by the local comparison, and passing local tests cannot be called fixes. No further full suite or clean-master replay was run. Ignored evidence includes branch-win1 through branch-win8 logs/reports, branch-failures.json, constrained-windows.log, master-windows.log and master-windows-revision.json under tests/.output/native-nightly/.

## Remaining Windows observations

| Group                            | Failed locations and boundary                                                                                                                                                                                                    | Next evidence needed                                                                                                                                                                                                                                              |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tutorial readiness and focus     | tutorials:394 (menu/Skip), :434, :476, :490, :517; :932 mobile-api, quick-add, webhooks, backlog-lag, autoscaling, backoff-budget; :961 threads-block, author-a-drill, retry-storm, backoff-budget, dead-letters, study-payments | Capture the session/import, runner and interaction states at the failed input. Some clicks stall after actionability succeeds; others never receive the expected Live or inspector surface. Do not replace the exact step checks.                                 |
| Checks/verifier readiness        | requests-wait-owner:7; requests-wait-checks:68 en/ar and :139 ar; lazy-live-fixes:172, :209, :227                                                                                                                                | Capture request/reply revisions and outstanding verifier work. Events is still offered where the test requires the confirmed fix, or its field never mounts.                                                                                                      |
| Simulation callout visibility    | sim-truth:412, :437                                                                                                                                                                                                              | The outage announcement exists while its visual callout is absent. The loss case records ten lost messages but reaches 57 simulated seconds. Capture lazy-surface readiness and tracker memory with the controller revision before inferring a missing detection. |
| Geometry and surface readiness   | imports:825; edge-route-model:112; inspector-live:201; live-large:183, :223; annotations:1767, :1014; followups4-inspector:148 en/ar; round13-polish:284 at 1280px/672px sheet                                                   | Capture font readiness, measured boxes and camera/selection revisions. The compact import card is 107.85px wide against the unchanged greater-than-110px oracle. Other targets are absent or details have the wrong row count.                                    |
| Interrupted fit                  | fit-settled:659                                                                                                                                                                                                                  | Capture ownership and pending jobs when no viewport change occurs within the existing 100-frame guard. Do not increase that guard.                                                                                                                                |
| Worker painting                  | lowzoom-chips:159 worker                                                                                                                                                                                                         | Capture pending worker frame/reply acknowledgements at the stop baseline: the count changes from 37 to 38. Keep the exact zero-additional-frames assertion.                                                                                                       |
| Mobile mutation and roving focus | showcase-examples:177; ux-resilience-followup:116                                                                                                                                                                                | Capture click selection and keyboard ownership when ArrowRight does not create an owned copy; capture timeline publication when no marker has the one required tab stop.                                                                                          |

The Windows outage trace includes five NodeDetails-related assets taking about 4.34 seconds and other lazy assets taking hundreds of milliseconds to seconds. Their responses succeed; this does not establish preview compression, disk contention or tracing as the cause. Worker-count reductions, trace disabling, speculative path substitutions and timeout/tolerance changes were rejected without a reproduced mechanism.

## Existing skips and macOS follow-ups

No skip or quarantine was added or changed. Windows shard 4's existing skips are checks-ui:83 (the diagram-scope diagnostics quarantine), slowmo:79, :127, :326 and :356 (the native teardown quarantine), plus ten opt-in lowzoom-captures:16 combinations. Those combinations are reco-40-edit, reco-40-live, bf-25-edit, bf-25-live and dd-35-edit in both light and dark. macOS shard 12 also has those ten opt-in capture skips. The separate existing Nightly teardown diagnostic still exercises its four quarantined slow-motion cases.

The completed macOS failures retain the initial triage's dispositions: peer/admission and collaboration-room cases need signaling/ICE lifecycle evidence; lowzoom-edge-edit:17 needs a camera/interaction trace; review-358:71 needs native select-popup choreography. The original macOS 9/12 hidden-dependency focus and phone narration containment proposals remain in the initial triage. Final native outcomes, interruption markers and any additional existing skips are listed in the PR.

This follow-up records verification evidence only. It changes no product code, test oracle, output golden, budget, worker setting or generated asset.
