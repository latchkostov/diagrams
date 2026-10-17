## Scope and decisions

This batch fixes AI panel readiness, menu refresh and recovery-write races, and changes test orchestration and synchronization. It adds no application controls or UI text.
The chrome budget, keyboard flows and production bundle boundaries remain the same. The reserved canvas
files are not edited.

Retries and hardware-based timeout multipliers are rejected: neither establishes readiness. Tests wait for
layout or focus, control asynchronous boundaries, or use fake simulation time. Slow-test annotations cover
multi-view workflows and substantial simulation/rendering work, not product latency assertions.

## Failure classification

The final report includes the native and capped Linux gate summaries for the committed head.

| Failures                                                             | Cause and change                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dictation on Windows/macOS and restored AI conversations             | A panel mounted without a canvas host, or remounted across a temporary host detach. Wait for the first host, retain panel identity across detachment, and make the dock inert while detached. The Mac trace confirms the shortcut starts listening before the remount; the modifier is correct.                                                                                                                     |
| Pending RTL locale refresh                                           | A queued LTR hover callback overwrote the newly placed RTL submenu. Cancel pending hover in locale-change layout cleanup. A controlled-clock regression reproduces the old placement and passes with cleanup.                                                                                                                                                                                                       |
| Slow motion, trace, live-render and similar menu helpers             | One-second click timeouts inside retries raced viewport refits. Wait for the viewport, then perform each action once with the standard action backstop.                                                                                                                                                                                                                                                             |
| Capacity validation, including rate/scale bounds and document budget | Intentionally invalid drafts ran through the live engine. Pause validation fixtures; keep playback active in the presenter and render-count cases. Multi-page persistence cases use `test.slow()`.                                                                                                                                                                                                                  |
| Lazy example history/reload flows                                    | Multiple cold views and a live session in one default-length test. Mark the shared multi-load setup slow.                                                                                                                                                                                                                                                                                                           |
| Showcase examples                                                    | Simulation time could advance while waiting for an animated fit. Pause first, finish the initial fit on the controlled clock, then restart and check the feature.                                                                                                                                                                                                                                                   |
| Interactive HTML and skill HTML                                      | Setup could consume the simulation before pixel/playing assertions. Install the clock before viewer startup, restart, and advance between samples; late installation changes the animation-loop origin and can freeze UI publication.                                                                                                                                                                               |
| Image slicing/cancellation                                           | Held clone/font/module setup shared the short action backstop. Wait for the explicitly held boundary using the whole-test backstop; annotate the conversion/cancel/retry workflow slow.                                                                                                                                                                                                                             |
| Saved live simulation and waiting narration                          | Short-lived pending/playing states could pass before assertions ran. Restart or continue on a controlled clock.                                                                                                                                                                                                                                                                                                     |
| Autoscaling production playback                                      | Setup could advance the simulation before the controlled sequence began. Restart at zero before the readiness/resource/history sequence, and annotate the multi-stage workflow slow.                                                                                                                                                                                                                                |
| Worker renderer                                                      | A fixed observation time required a minimum number of frames and mixed cold setup with steady rendering. Await fonts, idle and fit; observe three frame-counted windows per renderer, retaining zero-draw/animation checks and the same-run CPU comparison.                                                                                                                                                         |
| Gallery accessibility                                                | Axe could measure partially transparent entrance-animation colours. Await the dialog and ancestor animation completions before auditing.                                                                                                                                                                                                                                                                            |
| First-run and blank title-card tests                                 | Typing preceded the lazy search's focus. Wait for its focused search. Type-ahead behavior has separate tests.                                                                                                                                                                                                                                                                                                       |
| Connection naming                                                    | Filling the label could race initial focus and finalize the creation transaction. Wait for label focus before editing and tabbing to the connection.                                                                                                                                                                                                                                                                |
| Owned title undo                                                     | The dev trace took 1.77 seconds to type the title, crossing the 1.5-second history merge window. Keep the intended rapid edit on a controlled clock, retaining the clear, character input, Undo and reload assertions.                                                                                                                                                                                              |
| Room recovery/rejoin                                                 | An edit between the last write-loop check and promise cleanup could remain queued forever. Drain the queued revision when releasing the previous job, and keep flush callers waiting for it. A microtask-controlled regression fails without the fix. The reported dev failure had completed the assertions before its 30-second whole-test/teardown limit: annotate the multi-context reload/rejoin workflow slow. |
| Import report (KEDA and localized File dialogs)                      | The toast moves while the imported canvas mounts. Wait for the imported title, viewport and Details button before the pointer action. The Linux trace retains the toast after the missed click.                                                                                                                                                                                                                     |
| Checks responsiveness                                                | Two separate reads of started/finished counters could straddle a completion. Read one atomic snapshot.                                                                                                                                                                                                                                                                                                              |
| Checks simulation command palette                                    | The first lazy palette load on a 1,500-node fixture used the short assertion backstop and typing preceded focus. Use the existing page-load backstop and await the focused command input.                                                                                                                                                                                                                           |
| Pending cloud save and privacy                                       | A fixed storage delay could finish before the privacy edit. Hold and explicitly release the operation.                                                                                                                                                                                                                                                                                                              |
| Planning revision in Live                                            | A single large fake-clock advance could precede the updated live session. Advance until each expected published state.                                                                                                                                                                                                                                                                                              |
| Dependency rendering                                                 | Serial browser round trips and sleeps made observation unnecessarily heavy. Read every dependency together over page frames.                                                                                                                                                                                                                                                                                        |
| Keyboard boundary/edge navigation                                    | Announcement precedes deferred focus. Wait for focus before the next sequential navigation key.                                                                                                                                                                                                                                                                                                                     |
| Tooltip render isolation                                             | Font readiness could commit a late canvas fit during the measurement. Await fonts before the baseline render count.                                                                                                                                                                                                                                                                                                 |
| Dependency hover stacking                                            | A tooltip hover bridge can cover the pip immediately after entry, making Playwright retry hover actionability. Move the real pointer to the settled pip, then assert the card stacking.                                                                                                                                                                                                                             |

| Nudge Undo across camera movement | Screen coordinates changed during Inspector adjustment. Assert exact diagram positions and Undo on a controlled history clock, including a deliberate camera pan. The screen-position assertion fails under that pan; the replacement passes three native repetitions. |
| Boundary resize membership | The inferred corner was behind the opening Inspector, so the gesture never resized. Await selection settlement, fit the diagram and target the real handle by test id; retain the toast and saved membership checks. |

## Resource invariant investigation

Nightly run 38851345020 at `16060ab9` completed its resource invariant tests in 225.84 seconds.
Commit `ca0bdd33` then added the A3 generator: the same job now runs 10,000 seeds, with longer
controller timelines. Seed partitioning preserves that expanded work while dividing it into four jobs.
The unchanged unsharded workload passed all 10,006 tests locally in 1,005.26 seconds: seed durations
sum to 325.91 seconds for A1 and 677.76 seconds for A3. No engine changes or reduced seed counts are needed.

## Verification

The affected-case gate passed three complete repetitions under Docker limits of **3 CPUs and 7 GiB**,
with the auto-selected **one worker** and **zero retries**: **549 passed, 0 failed, 0 flaky**.
Each repetition includes 181 production Chromium cases and two dev-tagged regressions. The same
reported cases, visual checks and full 1,500-node stress fixtures remain in the selection. Docker
inspection confirmed the CPU and memory limits were applied, rather than only limiting workers.
A separate dev-server replay under the same caps passed all **12 executions**: recovery/rejoin,
title-first Undo, complete KEDA import and worker rendering, each repeated three times with zero retries.
This covers the generic dev Nightly cases that the full gate's dev-tagged project does not select.
The same 12 executions passed again after syncing onto #148.

Deliberate regression checks remove each product fix: host detachment stops dictation, stale locale hover
places the submenu incorrectly, and write completion loses the queued recovery revision. Restoring the
fixes passes their regressions (including all 77 recovery tests). Removing Docker cap propagation, unit
worker propagation or seed partitioning also fails the corresponding tests. A controlled entrance animation
reproduces the gallery contrast failure until animation readiness is restored.

Native targeted checks passed 50 initial cases, 39 import/gallery/dictation repetitions, 18 HTML export
repetitions, six AI/RTL regression repetitions, 15 microphone/host/title repetitions, six capacity cases,
and six recovery/thread repetitions, with retries disabled. Seven image/planning/autoscaling cases, 12 hover/navigation repetitions and six dev title/recovery repetitions also pass. Intermediate runs exposed a paused-clock
setup error, a duplicate import and a mistaken edge-wrapper selector; those were corrected, rather than retrying failed tests or recording
new goldens. The final report records complete native and capped gate results after the final commit.

Before sync, the optional standalone E2E TypeScript config reported 76 existing diagnostics on both
the original HEAD and the edited tests; the required `pnpm typecheck` passes. An exploratory 16× CPU throttle
applied before canvas readiness timed out in setup for both versions of the title test; 8×
after readiness passed both versions and is not counted as a reproduced regression.

After sync onto #148 (`1437f0bd`), checks passed the complete unit run (**8,916 passed, 4 skipped**, no type errors),
production build, entry-size check (**107.2 kB gzip / 123.5 kB budget**), regeneration,
i18n validation (zero errors; existing missing translations/warnings retained), and skill freshness.
Full output parity passed **2,196 goldens: 0 changed, 0 added, 0 missing, 0 stale**; no goldens were re-recorded.
The required native and capped Linux full gates run after the final signed commit, with their exact
SUMMARY lines in the final report.

## Full-gate correction

The first native full gate at `d75a2643` passed all 8,916 unit tests, the 2,196 unchanged goldens
and 1,576 browser cases, but failed the encrypted skill HTML playback case. The shared playback
helper installed its clock after startup: the animation loop retained timestamps from the old
performance origin, and the paused clock could leave the narration at time zero. Clock installation
now precedes viewer navigation. A regression shifts the monotonic origin consistently before
checking playback, without any real delay. Temporarily restoring late installation reproduces
the stale narration; restoring the fix passes that regression and the password case three times.
The failed gate is not treated as an exception; both full gates are rerun on the corrected signed head.

The corrected HTML/app-skill/offline-planning selection then passed three capped repetitions
(**66 passed, 0 failed, 0 flaky**, one auto worker, 3 CPUs and 7 GiB). The password, sandboxed
iframe, storage-isolation and pixel assertions remain intact.

## Capped full-gate correction

The first capped Linux full gate at `563fdf3b` exposed a nudge-test assertion that compared screen
positions across a camera adjustment (150 pixels after Undo). The replacement waits for selection
settlement and reads the React Flow node's diagram transform. It deliberately pans the camera,
checks the exact snapped 100-pixel nudge and exact Undo, and controls the history merge window
with a clock installed before navigation. Restoring the old screen-position assertion fails under
the same controlled pan; the diagram-position assertion passes. Three native repetitions passed.
The failed full gate is not an exception; both final full gates run again after this correction and
sync onto the latest master.

The same capped run also missed the boundary resize handle: its measured screen corner was at
x=1308, behind the opening Inspector, so no resize occurred. The test now waits for selection
settlement, fits the diagram and targets the real `group-resize-ship-bottom-right` handle.
The toast and saved membership assertions remain. Three native repetitions pass.
That full run completed **1,576 passed, 2 failed, 0 flaky**; unit, build, size and all 2,196 unchanged
goldens passed. Both corrections are included before rerunning either final full gate.

The branch was then synced onto renderer performance PR #149 (`cb6ff3ac`). The complete editor,
structure/bulk and live-render specs are repeated under the same caps before the final commit.
All originally reported native cases in the classification table were covered by the 549-execution
capped selection; the four generic dev Nightly cases have their separate 12-execution replay.

A native attempt with the unchanged resize test passed three times. A controlled camera pan then
reproduced its missing-toast failure with the old corner gesture. The corrected fit-and-handle
sequence passed the same controlled-pan scenario three times. This isolates handle visibility
from storage and toast timing; it does not rely on a slower host to reproduce the problem.

## Renderer publication after sync

PR #149 applies decorations on the UI publication cadence. The waiting-note test's one 125 ms
fake-clock advance could end before the animation frame that publishes the resumed decoration;
then its stopped clock left the assertion waiting forever. Await the controller's playing state,
and keep advancing the controlled clock until the resumed decoration is published. Both renderer
paths pass three native repetitions (six cases) with this change. The capped pre-fix repetition
exposed both failures; its other two repetitions passed them, confirming the phase-dependent setup.

That capped selection finished **162 passed, 3 failed, 0 flaky**. Two failures were the publication
boundary above. The third was caused by a concurrent native diagnostic rebuilding the same scratch
bundle: the trace records a 404 for the app page, before the canvas mounted. No app-load timeout is
changed for this interference. The complete selection is repeated with an unchanged build and no
concurrent diagnostic build. Parity still passed all 2,196 goldens unchanged.

After the sync onto #149, the four generic dev Nightly cases again passed all **12 executions** under
3 CPUs, 7 GiB, one auto worker and zero retries.

The clean complete editor, structure/bulk and live-render repetition passed **165 executions,
0 failed, 0 flaky**, under the same 3 CPU / 7 GiB caps, one auto worker and zero retries.
All three corrections (diagram-coordinate Undo, visible resize handle, and renderer publication)
were included in every repetition. No concurrent build or diagnostic ran alongside this check.
