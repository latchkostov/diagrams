## Completed implementation Nightly

Ready [PR #411](https://github.com/latchkostov/diagrams/pull/411), **Nightly: native browser failures, round 5**, contains fourteen signed implementation/test commits. Dispatched [Nightly 41276976443](https://github.com/latchkostov/diagrams/actions/runs/41276976443) verifies implementation commit `ff4fd545474c166b8c165bfef77ed8de1417c42c` and completes with failure. This final verification fragment changes no code or tests.

| OS/mode                        | Passed | Failed | Existing skips | Unfinished |
| ------------------------------ | -----: | -----: | -------------: | ---------: |
| Windows                        |   3241 |     14 |             15 |          0 |
| macOS                          |   3242 |     17 |             11 |          0 |
| Linux Dev                      |   3219 |      1 |             50 |          0 |
| Linux Build, three repetitions |   9775 |      2 |             33 |          0 |

All forty E2E reports are present. Each native/dev inventory has 3,270 executions including existing skips; Build has 9,810. No report has a runner error or interruption marker. No skip, quarantine, retry, timeout, tolerance or budget is added or raised. Nightly has no failed unit or heavy-test job. The remaining failures below stay enabled.

## What the repairs establish

Late worker fonts now invalidate the normal frame loop instead of independently repainting the worker's last snapshot. Hidden low-zoom layers stay idle; visible paused drawings redraw, including when an older acknowledgement arrives first. This is the sole product renderer change.

Drivers acknowledge completed save notifications, the current autosave, finite entrances, real keyboard return after Retry, menu ownership, handoff readiness, final camera refinement, the authored verification snapshot and actual recording start. The renderer CPU comparison retains its original assertions while excluding per-frame trace capture from the measurement. Each readiness repair has a failing temporary-reversion regression; renderer measurement has constrained before/after rate evidence.

Both relationship AA audits pass on macOS in light and dark; no colour-token change is justified. The save-toast, lazy Retry, Sequence Retry and controlled recording cases pass. The new held-scrollend regression passes, but the original macOS scrolling cases still fail exact Home=0 with offsets 4 and 27. Its independent boundary-handoff repair does not establish that macOS scrolling is fixed. Earlier native worker-throughput failure evidence also prevents claiming that measurement's flake eliminated from one passing final run.

## Remaining Windows groups

- Example/Live/import readiness (3): `lazy-examples.spec.ts:293`, `live-large.spec.ts:183`, and `annotations.spec.ts:1193`.
- Lab rendering (3): `lab.spec.ts:67`, parts 1, 2 and 3 reach their existing whole-test deadline.
- Keyboard/tutorial controls (3): the cold-start note in `tutorials.spec.ts:572`, saved-simulations in `tutorials-keyboard-3.spec.ts:6`, and the firewall radio group in `network-devices.spec.ts:170`.
- Real recording capture (2): worker-path start and main-path stop readiness in `live-record-capture.spec.ts:339`.
- Collaboration following (2): late joining and restarting/changing simulations in `watch-together.spec.ts:195` and `:212`. No server, TURN or tracker changes are made.
- Confirmed-fix persistence (1): `requests-wait-owner.spec.ts:73` cannot read a persisted diagram owned by the current document.

These are observed failure groups, not claims that every underlying cause has been proved.

## Remaining macOS groups

- Keyboard replay (9): study-fanout, fanout, faults, dots-and-sides, kafka-topic, dependencies-2, scale-to-zero, load-shedding and study-cells. Failures include unreachable controls/menu rows and uncompleted authored steps.
- Pointer tutorial replay (1): study-payments remains on never-double-charge in `tutorials-solutions-3.spec.ts:7`.
- Quick-add naming (1): `bundle-trim.spec.ts:399` retains Redis Cache instead of Cache audit.
- Toast/control geometry (2): `toast-interaction.spec.ts:306` and `examples-picker.spec.ts:384` cannot measure the expected control/notification.
- Nested selection/Undo (1): `zones-boundaries.spec.ts:313` loses the expected group inspector field.
- Dependency-list content (1): `relationships.spec.ts:616` misses the exact delimiter-bearing dependency content. This is separate from the passing contrast audits.
- Native scrolling (2): embed and presentation in `latency.spec.ts:384` still fail the unchanged first Home=0 assertion at line 421.

## Remaining Linux groups

Dev has one failure: `imports.spec.ts:103`, dropping a compose file and its override leaves the expected topic node hidden. The previously reported edge-persistence, RTL coach and keyboard replay cases pass in this inventory.

Build has two deadline failures in the three repetitions of `lowzoom-chips.spec.ts:229`. All lazy-surface cases pass. SVG export performance remains unresolved: six roughly 9.46 MB captures accumulate cold-load, computed-style copying and serialization work. Completed comparisons match; observed traces do not establish a stuck readiness wait.

## Camera rule and PR CI remain open

Implementation [CI 41276975426](https://github.com/latchkostov/diagrams/actions/runs/41276975426) fails E2E 5/6 in `lowzoom-review.spec.ts:52`. The trace shows Ctrl+Alt+[ selecting an incoming edge from a 50% Custom view, then the camera entering Focus at about 112%. The current camera policy explicitly enters readable Focus for keyboard navigation below 60%; the test requires preserving 50%.

The user's standing rule requires clarification when intended camera behavior is unclear. The question is pending: preserve manual zoom for edge navigation, or enter readable Focus below 60%. Neither behavior nor its assertion is changed while that rule is unresolved.

Only this spec was run once on clean `origin/master`, with two Linux repetitions in this same worktree. All ten executions pass, so the identical CI failure is not established as pre-existing. The branch was restored immediately; no stash or other worktree was used.

```text
SUMMARY: bf9e103b5ed6599b3619784274c82143f3ec2ff1 | unit="not run" parity="not run" e2e={"passed":10,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

## Matching scheduled-master evidence

The newest completed master run is scheduled [Nightly 41273024955](https://github.com/latchkostov/diagrams/actions/runs/41273024955), source `bf9e103b5ed6599b3619784274c82143f3ec2ff1`. It was inspected, never cancelled or rerun. Its Windows inventory is 3,250 passed/19 failed/15 skipped; macOS 3,259/14/11; Dev 3,231/3/50; Build 9,818/1/33. All have zero unfinished cases. Master includes tutorial batch five (#412), so its 3,284-case inventory differs from this branch's 3,270; pass totals are not a matched performance comparison.

Two Windows failures have exactly matching error text in that clean master run: the scale-to-zero cold-start note cannot find live-note-continue, and Lab part 1 reaches its unchanged 120-second whole-test deadline. Their completed master jobs report:

```text
SUMMARY: bf9e103b5ed6599b3619784274c82143f3ec2ff1 | unit="not run" parity="not run" e2e={"passed":368,"failed":6,"flaky":0,"skipped":0} gate_failures=1
SUMMARY: bf9e103b5ed6599b3619784274c82143f3ec2ff1 | unit="not run" parity="not run" e2e={"passed":369,"failed":3,"flaky":0,"skipped":0} gate_failures=1
```

Watch-together and confirmed-fix ownership have matching case titles but different errors, so they are not labelled identical pre-existing failures. Master also reproduces one SVG deadline failure; the requested performance repair remains open regardless.

## Local validation and rejected experiments

Affected Linux cohorts total 1,032 passing executions, two repetitions per cohort, zero failed/flaky. The final entire latency spec passes 30 constrained Windows executions and 30 Linux executions. Its held native scrollend regression fails when the boundary fallback is temporarily restored.

Affected units pass, including all 31 renderer/protocol cases and all 30 reserve heavy cases. Build and entry-size checks pass. Full parity passes with all 3,178 goldens unchanged: zero changed, added, missing or stale; none is re-recorded. Later changes affect tests/docs only. Lint, pnpm typecheck, format:check and prettier --check . pass after final edits before signing; lint has eleven existing warnings and zero errors. No full local suite/gate is queued in this fix round.

The product and last targeted quick gates include their subsequent working-tree changes; the SHA in each summary names the pre-commit HEAD:

```text
SUMMARY: 7fc2488ed1a723348eb4c8eda2973163d9907d8f | unit={"passed":61,"failed":0,"skipped":0} parity={"goldens":3178,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":64,"failed":0,"flaky":0,"skipped":0} gate_failures=0
SUMMARY: afff54d82e4d54bfe81e5475c9f0a61d4c4d84a3 | unit="not run" parity="not run" e2e={"passed":30,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

Rejected CSS-copy experiments either change bytes or lack sufficient improvement. One ignored native-declaration-order prototype preserves all 995 measured HTML style blocks and complete 15.5 MB SVGs in three pairs, improving complete-capture timings by 6-12%; all three constrained low-zoom repetitions still hit the original deadline. Further shorthand and dimension-cache variants change serialized bytes. None is shipped as a repair. Speculative colour, scroll-anchor, scrollbar, zoom and broad trace changes are not substituted for causal evidence.

Superseded branch dispatches 41267020590, 41268803420, 41269956615, 41271786390 and 41273768573 were cancelled after exposing later causes; their partial inventories do not verify this final implementation. The completed current-head table above uses only run 41276976443.
