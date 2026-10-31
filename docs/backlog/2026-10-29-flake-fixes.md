## Browser flake investigation

Baseline: `31d4b40c8`, branch `fix/flakes-1028`. Read the first-attempt job logs
and failure screenshots/traces for all four reports. Local raw evidence stays in
`tests/.output/flake-investigation/`.

## Buffered naming persistence

[Job 122912270005](https://github.com/latchkostov/diagrams/actions/runs/40714679287/job/122912270005)
reads the previous, valid autosave immediately after creating a node. Its source
does not contain #384's subsequent poll for a non-origin node. Keep that poll:
readability of the autosave is not acknowledgement of the placement. No additional
product change is justified by this historical failure alone.

## Checks typing setup

[Job 123196224521](https://github.com/latchkostov/diagrams/actions/runs/40796803489/job/123196224521)
accepts any warning count after importing the 1,500-node fixture. The preceding
document already has a warning; that count can satisfy setup before the imported
document's worker result arrives. The finding then misses its existing assertion
backstop. Await this fixture's exact warning count before opening its finding;
preserve all rendering budgets and measured work.

## Fit and low-zoom publication

[Job 123222573589](https://github.com/latchkostov/diagrams/actions/runs/40804988708/job/123222573589)
compares natural edge paths with chip paths. The trace has current `data-detail-zoom`
while `data-chip-fits` still describes the preceding zoom. A sampled stable drawing
does not establish completion of the separate chip publication. Expose its pending
state and include it in canvas readiness, completing publication before clearing it.

## Latency readout pinning

[Job 123238632007](https://github.com/latchkostov/diagrams/actions/runs/40809510196/job/123238632007)
never reaches `data-pinned="true"`. Its trace shows the narration, title and card
moving after the helper samples a stable viewport. The coordinate click misses the
card's header; the later latency row is clipped in the unpinned summary. Await the
camera's actual completion and pin through the named header, then require the
pinned state before opening a section.

## Before-fix evidence

Pinned Playwright Linux image, four workers sharing a two-CPU quota, ports
6660–6664, `--repeat-each 30`, zero retries. These are concurrent browser workloads,
not wall-clock performance assertions. The baseline production bundle was checked
to contain none of the new chip-readiness signal.

- Checks: 3/30 missing-finding failures matching CI; 1/30 whole-test teardown
  deadline after its assertions passed; 26/30 passed. Keep the deadline separate
  from the reported readiness defect.
- Fit: 1/30 early Auto-layout comparisons reproduced the natural/chip edge-path
  mismatch. Opening, Auto-layout chrome and Auto-layout then Fit view each passed
  30/30. Aggregate: 1/120 failed, with the reported exact variant not reproduced.
- Latency: presentation reproduced the CI click timeout in 1/30; embed passed 30/30.
- Naming: temporarily removing only #384's persistence poll passed 30/30 clone and
  30/30 quick-add cases. This load did not reproduce that historical failure, so
  it is not evidence of a measured failure-rate improvement. The poll was restored.
  Its owning commit is `9798327fa` (#384); the failed CI source lacks it.

Baseline reports: `tests/.output/g/rwVWxJb`; naming reversion reports:
`tests/.output/g/rXyzDVA`. The baseline SUMMARY is 204 passed, 6 failed, 0 flaky,
0 skipped. The naming reversion SUMMARY is 60 passed, 0 failed, 0 flaky, 0 skipped.

The chip-readiness unit regression also fails with the application change
temporarily reverted: 1 failed, 9 passed. Restoring it passes all 10 cases.

## Checks trace-capture overhead

The intermediate readiness-fixed run completed all 30 Checks samples with zero
missing-finding failures, but two whole-test teardown deadlines (28 passed).
Their assertions finished before teardown, just as in the baseline deadline.
The baseline trace contains 724 screencast frames and is 46,506,498 compressed bytes;
an intermediate deadline trace has 713 frames. Continuous capture is test
instrumentation, not the application work this operation-count test measures.

Disable continuous screenshots on `performanceTest`, alongside its existing
disabled DOM snapshots. Action traces and the separate failure PNG remain available.
Keep every input sample, worker execution, render assertion and the existing
backstop. Verify this additional test-instrumentation fix with a separate 30-repeat
Checks run under the same CPU quota and worker count.

## Related triage boundaries

Group K's later imported-finding signature is covered by the exact-count wait.
Keep the existing frozen-debounce setup regression: the earlier Nightly completion
wait is a distinct boundary, not proof that every group K failure has one cause.
Group N's search highlighting, held settings and annotation focus cases are included
in the neighbouring-spec sweep (`bundle-trim`, `trim3`, `text-fields`). No speculative
menu or naming state-machine rewrite is justified by the autosave-read failure.

The neighbour sweep reproduced both `bundle-trim` search-navigation variants once
in two repetitions (2/4 failed). The keyboard page's trace shows
`quick-add-search-loading` and no result rows immediately before ArrowDown. The
arrow cannot navigate an absent list; Enter queues the first match once it arrives,
so the keyboard selects Generic Cache while the mouse selected Redis. This is a
search-readiness boundary, not evidence of a stale committed keyboard handler.

Wait for an active search-result row before navigation. The held-settings naming
test and shape naming tests cross the same boundary before navigation or freezing
their clock; prepare those searches too. Keep their typing-before-field-focus,
selection, exact stencil, name and undo assertions unchanged. Do not add a name-field
focus wait that would erase the buffering coverage.

The complete neighbour sweep ended **753 passed, 3 failed, 0 flaky, 2 existing skips**
(`tests/.output/g/r9JDm74`). Its third failure was the explicitly cleared type-ahead
name test (1/2 executions): the trace shows search still loading when clock
installation began, then no label field at the pre-measurement assertion. Prepare
that search before freezing too. All other cases in the twenty-spec sweep passed;
the skipped diagnostics case is unchanged and appears once per repetition.

An initial validation of the guard (`rJJGoOl`) was stopped after its overly narrow
item-id prefix excluded shape rows. Scope it to every item inside the Quick-add
menu instead. No success or before/after rate is inferred from that incomplete run.

## After-fix drawing and handover evidence

The same four-worker/two-CPU, 30-repeat protocol completed all **240/240** fit,
naming and latency executions without a failure, flaky result or skip:

| Case                              | Before                          | After |
| --------------------------------- | ------------------------------- | ----- |
| Fit: opening                      | 0/30 failed                     | 0/30  |
| Fit: early Auto-layout            | 1/30 path mismatches            | 0/30  |
| Fit: Auto-layout chrome           | 0/30 failed                     | 0/30  |
| Fit: Auto-layout then Fit view    | 0/30 failed; CI trace inspected | 0/30  |
| Latency: embed                    | 0/30 failed                     | 0/30  |
| Latency: presentation             | 1/30 click timeouts             | 0/30  |
| Naming: clone, #384 poll restored | 0/30 with poll removed          | 0/30  |
| Naming: quick-add, poll restored  | 0/30 with poll removed          | 0/30  |

Reports: `tests/.output/g/rGlhwov`. Its complete SUMMARY is **268 passed, 2 failed,
0 flaky, 0 skipped**: the two failures are the separately identified Checks teardown
deadlines, before the trace-capture change. It is not reported as a passing gate.

## Final Checks recheck

With exact finding readiness and continuous trace capture disabled, all **30/30**
Checks executions pass under the same four-worker/two-CPU quota, with zero failed,
flaky or skipped cases. Every one still performs all 21 measured real worker runs
and retains the original rendering assertions. Reports: `tests/.output/g/rcOSE6Y`.

```text
SUMMARY: 31d4b40c826afa44be1f4b4c9c18b47551f5136e | unit="not run" parity="not run" e2e={"passed":30,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

## Final menu and naming recheck

All **210/210** executions of the seven related cases pass (30 each), with eight
workers sharing four CPUs, the same load settings as the original neighbour
failures. This covers both search-navigation variants, held-settings naming,
immediate typing after a pick, explicitly clearing the name, and both shape-naming
variants. No failures, flaky results or skips. Reports: `tests/.output/g/r11We8X`.
The original neighbour run had 3/14 failures across these seven cases; the other
related cases were guarded for the same search-readiness boundary, not claimed as
additional reproduced failures.

```text
SUMMARY: 31d4b40c826afa44be1f4b4c9c18b47551f5136e | unit="not run" parity="not run" e2e={"passed":210,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

## Complete neighbouring specs and validation

The three changed related specs (`bundle-trim`, `trim3`, `text-fields`) pass in
their entirety twice: **106 passed, 0 failed, 0 flaky, 0 skipped**, eight workers
on four CPUs. Reports: `tests/.output/g/rHNzIY3`. The other seventeen specs already
passed twice in the original neighbour sweep (650 passed, 2 existing skips).
Together this covers the complete 758-execution neighbour scope; the original
three failures are resolved and were rechecked in complete files after the fix.
No unchanged full suite was rerun.

```text
SUMMARY: 31d4b40c826afa44be1f4b4c9c18b47551f5136e | unit="not run" parity="not run" e2e={"passed":106,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

- Targeted units and startup/reserve heavy checks: **44 passed**. The fourteen
  application units also pass after the final application edit.
- Production build and `pnpm size`: pass. No budget or reserve changed.
- `pnpm parity`: **3,178 goldens, 0 changed, 0 added, 0 missing, 0 stale**.
  No golden was re-recorded.
- `pnpm regen` and `pnpm skill:check`: pass; commit the refreshed viewer template.
- Final lint, typecheck, `format:check` and `pnpm exec prettier --check .` run after
  this last edit, immediately before the signed commits. Lint has eleven existing
  warnings and no errors in the preceding check.

The fix-round protocol leaves the full unit/browser suite to PR CI. No retries,
larger timeouts, weaker tolerances, skips or quarantines were introduced. No engine
or model behavior, menu semantics or naming state machine was rewritten without
evidence. All servers and containers created by completed gates were stopped by
the gate; the interrupted guard-validation container was explicitly stopped.

## Hover-card focused-target removal (2026-10-29 follow-up)

[Job 122705505116](https://github.com/latchkostov/diagrams/actions/runs/40655300204/job/122705505116)
fails `removing a focused edge readout target recovers canvas focus` before any
deletion: its initial `edge-detail-call` never opens. The first-attempt log and
trace show Live controls visible while `data-camera-state` is still `pending`.
The forced SVG click samples `(1112.21, 348.78)` before the camera corrects the
view upward by 28 pixels. By input dispatch the camera is idle at 106% zoom and
the stroke has moved away. A later card wait cannot repair a missed pointer move.

Wait for camera idle before choosing an exposed stroke point, then pin through
the named header and require the pinned state before focusing the section. After
Undo, observe camera completion and the node's Live badge before hovering the
restored target. Keep the canvas-focus recovery and unpinned-card assertions.
This is test setup readiness; the trace does not support changing focus recovery
or Undo in the app.

## Hover-card pinned-target deletion (2026-10-29 follow-up)

[Job 123294824853](https://github.com/latchkostov/diagrams/actions/runs/40827694466/job/123294824853)
fails `deleting a pinned edge closes its readout and Undo restores an unpinned
target` at the initial card visibility assertion, before pinning or deleting.
Its first-attempt trace has the same pending camera, sampled pointer position,
28-pixel correction and final 106% view as the focused-target failure above.

Use the same camera/stroke/header readiness sequence. Observe the restored node's
Live snapshot as well as its canvas presence after Undo. Retain deletion, card
closure, restored target, visibility and `data-pinned="false"` assertions. There
is no evidence here of a product bug reopening a pinned readout after Undo.

## Quick-add highlighted-row navigation (verification of #392)

[Job 123271423867](https://github.com/latchkostov/diagrams/actions/runs/40820334489/job/123271423867)
fails `searchable menu navigation picks the highlighted row`. Its trace sends
ArrowDown and reads the highlighted row while `quick-add-search-loading` is
still present. The trace's source lacks #392's two `waitForQuickAddResults`
calls. Search intentionally shows no rows until both stencil metadata and search
code are ready, then publishes a highlighted choice with the results.

Keep #392's waits before navigation, including after later query edits. Removing
only those two calls locally reproduces the exact missing-highlight exception
under Linux load. No additional menu behavior change is justified. The pointer
and keyboard choices must still match; no assertion or timeout is relaxed.

## Hover-card follow-up before-fix measurements

Pinned Playwright Linux image, production E2E bundle, four workers sharing a
two-CPU quota, ports 6680–6684, `--repeat-each 30`, zero retries. The first run of
the unmodified branch passes all six cases (both node/edge deletion variants and
both menu variants): **180 passed, 0 failed, 0 flaky, 0 skipped**. Reports:
`tests/.output/g/rVdbFHb`.

The second run keeps that configuration, adds 4× browser CPU throttling to the
two edge cases and temporarily removes only #392's two quick-add readiness waits.
Reports: `tests/.output/g/rEw6s85`.

| Case                                                | Before failures / executions |
| --------------------------------------------------- | ---------------------------- |
| Focused edge target removal                         | 0/30                         |
| Pinned edge target deletion                         | 0/30                         |
| Quick-add navigation, waits removed                 | 2/30                         |
| Quick-add navigation and later edits, waits removed | 1/30                         |

Both node variants also pass 30/30. All three failures are the exact reported
`Quick-add has no highlighted row` exception. Total: **177 passed, 3 failed,
0 flaky, 0 skipped**. The original waits are restored after this deliberate
regression check; no additional quick-add source change is needed.

The natural hover-card CI miss did not reproduce in either local configuration.
These measurements cannot establish a local failure-rate reduction for those
two tests. The readiness fix follows the two independently matching CI traces,
including their pending camera and identical stale coordinates. Raw CI logs and
extracted traces remain in `tests/.output/hovercards/`.

## Hover-card follow-up output checks

Reports: `tests/.output/g/ri83toq`. The complete startup/reserve heavy file passes
**30/30**, and production build and `pnpm size` pass. `pnpm parity` checks
**3,178 goldens: 0 changed, 0 added, 0 missing, 0 stale**. No golden is re-recorded.
No application code is changed, so there are no additional affected app units.

## Hover-card resume baseline (2026-10-30)

Merged current `origin/master` (`be15437c1`) into this branch before resuming;
Git could fast-forward, so no rebase or merge conflict was needed. Re-read the
first-attempt logs and extracted traces linked above. Both hover-card traces
show the same pending-to-idle camera transition and 28-pixel vertical correction
between point sampling and input dispatch, at 106% zoom.

Also inspected the current [Nightly run 41003070821](https://github.com/latchkostov/diagrams/actions/runs/41003070821),
including native job logs and structured result artifacts. All 42 hover-card
cases passed on Windows shard 8 and macOS shard 10, including both edge cases in
this fix. Windows shard 8's failure is in `network-devices`; macOS shard 10 has
13 room-admission failures and is interrupted by its action deadline. These are
baseline observations, not failures caused by this patch or claims that the
intermittent hover-card race is absent. No unrelated Nightly fix is included.

The first resumed load command selected the surrounding loop lines instead of
the moved hover-card test declarations. It selected only the two menu variants;
it was stopped and is not an after-fix rate measurement. Its incomplete report
(`tests/.output/g/rjbmoyS`) has 7 passed, 1 whole-test deadline, 4 interrupted and
48 not run. The deadline occurs near the keyboard pick's final autosave read,
not at the missing-highlight exception. The menu spec, fixtures and application
source in that run are identical to current master. No deadline was increased.

## Hover-card follow-up after-fix load results (2026-10-30)

Reports: `tests/.output/g/rzlmGnp`. The corrected declaration-line selection runs
all six cases, with the same pinned Linux image, four workers, two-CPU quota,
ports 6680–6684 and 4× browser CPU throttle on the two edge cases as the earlier
throttled before run. Thirty repetitions per case, zero retries:

| Case                                                         | Before failures / executions | After failures / executions |
| ------------------------------------------------------------ | ---------------------------- | --------------------------- |
| Focused edge target removal                                  | 0/30                         | 0/30                        |
| Pinned edge target deletion                                  | 0/30                         | 0/30                        |
| Quick-add navigation, #392 waits removed/restored            | 2/30                         | 0/30                        |
| Quick-add navigation and later edits, waits removed/restored | 1/30                         | 0/30                        |
| Focused node target removal                                  | 0/30                         | 0/30                        |
| Pinned node target deletion                                  | 0/30                         | 0/30                        |

The complete after run is **180 passed, 0 failed, 0 flaky, 0 skipped**. The two
hover-card misses still have no locally reproduced before failure; their fix is
supported by the matching first-attempt CI traces, not a claimed local failure-rate
reduction or a successful local negative control. Quick-add's negative control
does reproduce the reported exception with the waits removed.

```text
SUMMARY: be15437c118de1c51077a49a8c426d2a9a9a43c9 | unit="not run" parity="not run" e2e={"passed":180,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

During the final check, master advanced to `e3ca5c7c7` (#395, camera ownership
through menu deferral and slow motion). Stopped that check during its unit step
(`tests/.output/g/rfFrjUF`, interrupted without a summary), merged master normally
and restarted final validation on the merged tree, including its camera units.
The completed 180-repeat measurement above retains its actual tested base.

## Hover-card merged-tree validation (2026-10-30)

Reports: `tests/.output/g/rZCAc7f`, on `e3ca5c7c7`. Linux, four workers and four
CPUs, explicit ports 6680–6684, production E2E builds, zero retries:

- Complete `hover-cards` and `bundle-trim` specs, two repetitions each:
  **114 passed, 0 failed, 0 flaky, 0 skipped**.
- Camera-controller units and the complete startup/reserve heavy file:
  **66 passed, 0 failed, 0 skipped** (36 camera, 30 reserve/build cases).
- Production build and `pnpm size`: pass; no budget or reserve changed.
- `pnpm parity`: **3,178 goldens, 0 changed, 0 added, 0 missing, 0 stale**.
  No golden was re-recorded.
- Final lint, typecheck, `format:check` and `pnpm exec prettier --check .` run
  after the final documentation edit, immediately before the signed commit.

```text
SUMMARY: e3ca5c7c711ab5a0b69610ae8d1af981ca15c49f | unit={"passed":66,"failed":0,"skipped":0} parity={"goldens":3178,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":114,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

The fix-round protocol leaves the full suite to PR CI. All gate-created servers
and containers are stopped. No retries, timeouts, tolerances, skips or assertions
were relaxed, and no application behavior is changed by this branch.
