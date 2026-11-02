## Branch dispatch

Nightly [41450369467](https://github.com/latchkostov/diagrams/actions/runs/41450369467)
tests signed integration commit `8d4ec65486fa1ee219107c9649251532a4b31584`, including master
`3eaf1c3c5` (#424 and #425). This results fragment is added afterward without changing tested
application, workflow, harness or test bytes. Counts come from all 40 structured browser reports,
not inferred from job conclusions or partial checkpoints. The run concludes failure because the
native failures below remain enabled; every Linux Dev and Build job passes.

| Suite          | Passed | Failed | Existing skips | Unfinished | Reports |
| -------------- | ------ | ------ | -------------- | ---------- | ------- |
| Windows        | 3,345  | 19     | 15             | 0          | 8/8     |
| macOS          | 3,361  | 7      | 11             | 0          | 12/12   |
| Linux Dev      | 3,327  | 0      | 52             | 0          | 8/8     |
| Linux Build x3 | 10,104 | 0      | 33             | 0          | 12/12   |

All suites record zero flakes, reporter errors, interrupted reports or unknown outcomes.
The green Dev and Build streak holds. Skip-count differences from round nine include
upstream inventory changes; this branch adds no skips or quarantines. Build's three repetitions
are included in its row rather than counted as one pass per case.

Windows completes all eight reports: 3,345 passed, 19 failed, 15 existing skips, zero unfinished,
flakes or reporter errors. The five new naming, Inspector-route and palette-navigation browser
regressions all pass on both Windows and macOS. Native unit/heavy cohorts complete six reports
per OS: 15,724 passed, zero failed and 13 existing skips on both Windows and macOS.

## Four unfinished cases now complete

Every macOS E2E step finishes within the unchanged limit; the longest takes 1,320 seconds
(22 minutes). The four formerly unfinished cases all pass, without changing their source:

| Case                                                  | Native result | Duration |
| ----------------------------------------------------- | ------------- | -------- |
| Checks typing while simulations play                  | Passed        | 17.207 s |
| Relay sharing privacy case                            | Passed        | 2.633 s  |
| Checks StrictMode mount from Ctrl+K (Dev)             | Passed        | 3.964 s  |
| Checks StrictMode mount from canvas right-click (Dev) | Passed        | 2.320 s  |

These complete native reports support the cumulative shard-deadline diagnosis. They do not
establish that no intermittent browser hang can ever occur or that native flake rates improved.

## Remaining macOS groups

- Both the quick-add keyboard lesson and tutorials-handoff's keyboard completion remain at
  `grow`. The latter never reaches its handoff-sheet assertions. In the lesson trace, Alt+Right
  opens the guided Service menu; a viewport change follows and the menu disappears before the
  recipe's Enter. This happens before the character-typing action and needs its own causal
  viewport/menu reproduction.
- Scale-on-backlog reaches step eight, Raise partitions to six, then times out navigating to
  the partition field before writing. Its failure snapshot shows the Poster workers Inspector
  although Render requests is the requested subject. This is a concrete focus/subject follow-up;
  the passing synthetic Inspector traversal cases do not prove that every live subject handoff
  is repaired.
- Flow-building's side-dot hit-area case misses the preview class on `handle-db-right` while
  dragging beside the plus. The test stops before releasing and checking the committed side.
  The preview/placement cause is unproven; no tolerance or assertion is changed.
- The study-payments pointer solution remains at `never-double-charge`, matching the exact
  recurring milestone observed on Windows and earlier native dispatches. Its keyboard recipe
  passes here; the pointer replay remains unresolved.
- Relationships' delimiter-bearing dependency case first passes its `data-count="1"` check,
  then cannot find `node-dependencies-worker` after focusing the pip. No wrong dependency text
  is observed: the list is absent. Track focus/list readiness before inferring an encoding or
  delimiter bug from the test title.
- Presentation latency scrolling repeats the exact Home-to-top failure: `scrollTop` is 9
  instead of 0 at line 421. Round nine observed 39. Keep the exact assertion and the compositor/
  keyboard-scroll investigation open; the changed residual is not evidence of a different cause.

The prior api-gateway, load-shedding and study-payments keyboard lessons all pass on macOS in
this dispatch. These are completed native observations, not a natural before/after flake rate.
The connection-preview failure and exact new tutorial/focus sites are tracked separately from
the recurring presentation Home observation.

## Remaining Windows groups

- Tutorial policy and browser commands: File Save as stalls after scrolling its visible/enabled
  button into view; Present and save-shortcut policy cases exhaust their whole-test limits.
  The circuit-breaker pointer solution stalls performing an edge hover. These are command-stall
  observations, not proof that each command has the same product cause.
- Tutorial replay/readouts: scale-to-zero misses the held cold-start Continue control;
  study-payments remains at `never-double-charge`; keyboard study-rag exhausts its test limit;
  keyboard shared-api-quotas misses the read-card-or-step-change predicate. The read action is
  unchanged by the direct Inspector field route. These remain enabled; passing controlled
  driver regressions does not establish that every keyboard recipe is repaired.
- Live/camera readiness: the large capacity-close case now times out in initial navigation,
  before reaching its capacity assertion. The small-diagram fade case times out waiting for
  identity zoom; its later failure snapshot already shows 80%. The latter observation alone
  cannot distinguish a camera defect from a delayed observation or paint.
- Checks/capture readiness: Checks typing fails its initial Checks-ready predicate, before
  comparing rendering work. The failEncoder case misses the capture-stop probe. Keep these
  separate from the earlier capture observation that counted two recording starts.
- Planner/readout readiness: planning-p2 misses the diagram-properties title field;
  pools-busy-threads misses the live scaling disclosure. requests-wait-owner and both
  requests-wait-review cases exhaust whole-test limits. The slowmo mid-replay exit case sees
  zero particles in its initial live setup, before entering replay or checking cleanup.
- Selection setup: round13-polish's 1,280 px/672 px-sheet case stalls clicking the initial
  selected edge label, before the Shift-box gesture. This differs from the earlier macOS
  negative-coordinate box observation; neither is assigned the other's root cause.

The broad replay, Live/capture and planner groups recur from rounds eight/nine. New exact
cases and changed failure sites above are observations, not established regressions or measured
flake rates. No timeout, tolerance, work budget, assertion, skip or quarantine changes are made.

## Rejected speculative repairs

The canvas naming failure is corrected in the recipe driver: Chromium direct insertion on a
noneditable canvas emits no events. A speculative application beforeinput buffer would not
receive anything and is discarded. Real character keydown buffering already works, including
the controlled held-measurement regression and saved-name Undo/Redo.

The original presentation Home observation ends at 39 px after Home is delivered. No causal
product reproduction supports a compositor workaround or weaker exact-scroll assertion, so
neither is added. The current macOS quick-add trace opens its menu after Alt+Right, then shows
a viewport change and the menu disappearing before Enter; this precedes any name-typing action.
Keep that concrete viewport/menu sequence for follow-up instead of claiming another naming fix.

## Local integrated verification

The final integrated Linux subset passes 1,666 units, including all 32 startup/reserve heavy
checks, build and size, and 3,178 parity goldens with zero changes. Its affected browser specs
pass twice: 180 executions, zero failures/flakes/skips. The timing-sensitive palette and six
neighbour groups separately pass 570 executions (five repeats, six workers/four CPUs).
Each controlled fix fails again with its correction temporarily reverted, then passes restored.

```text
SUMMARY: 0a51cdef1a2093540dff1a87eaeb7437b5743455 | unit={"passed":1666,"failed":0,"skipped":0} parity={"goldens":3178,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":180,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

This quick gate's SHA is its starting HEAD with the upstream merge in the working tree.
The resulting tested integration commit is `8d4ec65486fa1ee219107c9649251532a4b31584`.
Final lint, typecheck, format and explicit repository Prettier checks precede each signed commit.
The final results-document cohort passes all five fragment checks; `pnpm i18n check` reports
zero errors (existing missing/stale translations and warnings remain).
Only the inherited #424 i18n catalog golden changes across master integration; its sixteen new
selection messages and two catalog moves in 37 locales are explained in the integration release
fragment. No native-fix output golden is re-recorded.
