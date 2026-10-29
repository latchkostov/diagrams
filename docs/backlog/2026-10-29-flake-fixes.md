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
