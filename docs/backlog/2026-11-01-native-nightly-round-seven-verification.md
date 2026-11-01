## Scope and baseline

Ready [PR #417](https://github.com/latchkostov/diagrams/pull/417), **Nightly: native browser failures, round 7**, implements nine repairs through signed commit c726eb6ac4842e57b658a60a1f196f59e0ed4848. [Final branch Nightly 41323589959](https://github.com/latchkostov/diagrams/actions/runs/41323589959) tests that exact implementation. Application code last changes at bef905c1c1cbaa07165d8aac75634c6486e79537; the eighth and ninth repairs change only test setup and their causal notes.

Accepted baseline: [round-six Nightly 41300989083](https://github.com/latchkostov/diagrams/actions/runs/41300989083), included by starting master f302070c68caba1e427b8e0eca2870b9c18cb837. Its Windows inventory is 3,311 passed / 16 failed / 15 skipped; macOS 3,322 / 9 / 11; Linux Dev 3,290 / 2 / 50; Linux Build x3 9,990 / 3 / 33. All baseline inventories have zero unfinished.

Discovery retains all baseline cases and adds four browser regressions: the keyboard driver's native document-end recipe, its held quick-add focus handoff, completion taking focus before optional native speed input, and opening connection rules from the settled calm view. The new inventory is 3,346 executions, or 10,038 for Build x3; the baseline is 3,342, or 10,026. Existing exclusions and quarantine metadata are unchanged. Aggregate pass counts therefore are not a matched rate comparison.

## Repairs and causal evidence

- **Capture lifecycle:** Windows Dev reproduces the export-for-audience Continue warning in all three executions. Temporary console stack capture locates it in mountChips registering during active capture from IdentityDetail's effect. Synchronous publication now belongs to the capture entry point; late registration uses the normal React commit. The new actual chip-surface unit fails with the old suspension restored and passes with the fix. Existing immediate-subscriber and nested-capture tests remain. The continuation passes three Windows Dev executions afterward.
- **Palette keyboard ownership:** a real DOM regression moves to the second command with ArrowDown and republishes session context. The old component resets to the first result without another key. Stable command identity now survives context-only refreshes, with the current action and current index. A changed query still picks its best match. The final regression uses fresh DOM reads, passes after the fix and fails after restoring the old reset.
- **Failed-download target:** the Dev route also matched the catalog's static raw reference import, failing the outer lazy chunk before the sandbox loader could render its inline Retry. The matcher now lets raw references through. The unchanged loading, absent Start, inline Retry, successful retry and node assertions pass three Windows Dev executions. Removing the guard reproduces the original missing inline Retry again.
- **Native text boundaries:** the keyboard driver now applies the existing tutorialKey mapping already used by pointer recipes. Baseline macOS dependencies-2 inserts the new key at the start of an existing setting with the unmapped document-end combo. The new browser regression checks the exact multiline result. It passes twice on Windows; the full lesson passes three production executions. Windows does not establish macOS caret semantics; native results below provide that evidence.
- **Menu focus handoff:** baseline macOS api-gateway waits for interaction idle while quick-add stays open. The driver now waits for focus on its requested control or an actual menu owner before another key. It retains interaction/camera waits for canvas navigation. A held real quick-add focus regression reproduces the old idle wait on Windows and fails again with that wait restored. Final Windows production source passes three regression executions and three complete api-gateway lessons. The final native macOS case still fails at actual menu-owner focus, as recorded below.

- **Completion before native input:** first implementation CI 41310436389 fails circuit-breaker after the lesson finishes and its handoff sheet takes focus between the driver's focused snapshot and the native selection check. Only that spec is checked on clean master, twice in Linux: twenty pass, so an identical pre-existing failure is not established. Native selection now accepts an actual owner-finished signal, used only for optional tutorial speed input. A deterministic handoff regression yields CompletedStep without sending a key or changing the select. Both speed regressions pass three Windows production repetitions; restoring the old native helper fails the new regression again. Required choices retain exact focus, popup and value checks.

- **Menu focus ownership:** the second dispatch finds macOS study-cells and quick-add stopped in the exact menu-owner wait, with the menu visible and focus back on its node. A deterministic controller regression opens each of the three self-focusing canvas menus while a measured node focus move is pending, then lets the menu own focus and drains commits/frames. All three cases fail before the repair and after temporarily restoring the old policy: the node takes focus back. Menu opening now retires that older move through the existing cancellation path. The tests preserve the roving node and verify Escape restores its invoker. The policy invariant requires exact retirement for those three canvas menu kinds while retaining the previous pending move for Live popovers and dialogs. No camera or keyboard edge-navigation rule changes.

- **Finite renderer fixture:** the third dispatch's Windows worker case reads an unchanged clock after the finite Black Friday run has already completed at 13,840 ms. The trace explicitly shows live-play becoming done with all six expectations passing. Product completion is correct; polling a completed clock or raising its deadline is not a repair. The test now starts the scenario paused, places the initial view, freezes the page clock and starts playback once. It stays playing through both zoom transitions. Fake frames advance until viewport movement and pending chip work both clear. Four existing 1,000 ms measurement advances, strict clock progress and exact stopped/resumed paint counts remain. The final fixture passes six Windows executions on two CPUs and forty-two loaded Linux executions. Removing only paused=1 fails both added initial-state guards; the exact repaired bytes are restored. The old unmodified test passes all six isolated Windows executions, so that local baseline is not presented as reproducing the native failure.

- **Readable connection-rule surface:** the fourth dispatch's Windows firewall deny-rule screenshot shows the settled calm view at 51%, where the full connection label intentionally does not exist. Faster local runs had clicked a transient startup label. The two rule-editor cases now zoom to the readable view and wait for both viewport movement and chip work to settle. The new regression starts at a settled 40%, verifies the full label is absent and opens the exact rule editor through the readable view. All ten file cases pass three Windows repetitions on two CPUs. Replacing the helper with the old direct-label click fails the added regression; exact fixed bytes are restored. The Linux cohort with low-zoom edge-edit neighbours passes both repetitions (24 executions). No product rendering or camera policy changes.

Each cause is signed and pushed separately by normal fast-forward. No stash, rebase, force push, merge or other-worktree operation is used. The first five commits are pushed while master remains f302070c68caba1e427b8e0eca2870b9c18cb837. Fetches before the sixth, seventh, eighth and ninth find master at 706ae790629a1b668ef52a46a77d150377ca12b1, the separate SVG profiling/test split #416. The explicit no-rebase/no-merge instruction is retained; this branch's baseline and test inventory remain the round-six source.

## Local checks and exact summaries

Node 24.22.0, pnpm 12.11.2, native Windows Chromium and the pinned Linux Playwright image. The first five Linux cohorts declare four workers / four CPUs; the ownership, renderer and connection-surface cohorts declare six workers / four CPUs. Each runs twice, with zero retries and explicit owned ports. No local full gate or full test suite is queued in this fix round.

The eight accepted Linux cohorts pass **666 browser executions**, zero failed or flaky: export continuation 46, failed-download/fifth-keyboard group 22, palette/native-boundary fixture 28, and the complete main/fifth keyboard, handoff and new focus specs 116, native-select/keyboard-third/speed-handoff coverage 32, menu-ownership/keyboard/focus/viewport neighbours 356, and the final controlled renderer fixture with live-render neighbours 42, and readable connection labels with edge-edit neighbours 24. Unit gates pass the affected capture, palette and interaction tests plus all thirty startup/reserve heavy tests. The final application cohort passes 229 unit/reserve tests; no application source changes afterward. The keyboard inventory and platform-key contracts also pass. Production build and size pass.

Full output parity passes after the final application edit: **3,178 goldens, zero changed, added, missing or stale**. No golden is re-recorded. All three release fragments retain unchanged output; no schema, skill/i18n feed or plugin-version change is made.

```text
SUMMARY: f302070c68caba1e427b8e0eca2870b9c18cb837 | unit={"passed":46,"failed":0,"skipped":0} parity={"goldens":3178,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":46,"failed":0,"flaky":0,"skipped":0} gate_failures=0
SUMMARY: f302070c68caba1e427b8e0eca2870b9c18cb837 | unit={"passed":1,"failed":0,"skipped":0} parity={"goldens":3178,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":22,"failed":0,"flaky":0,"skipped":0} gate_failures=0
SUMMARY: 6a459b1fbd6f161c19e3bec1d29de47b895f7ad6 | unit={"passed":57,"failed":0,"skipped":0} parity={"goldens":3178,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":28,"failed":0,"flaky":0,"skipped":0} gate_failures=0
SUMMARY: 6a459b1fbd6f161c19e3bec1d29de47b895f7ad6 | unit="not run" parity={"goldens":3178,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":116,"failed":0,"flaky":0,"skipped":0} gate_failures=0
SUMMARY: 0a7fa5f69be43296cc4b169de0d9fd04005b287c | unit={"passed":2,"failed":0,"skipped":0} parity={"goldens":3178,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":32,"failed":0,"flaky":0,"skipped":0} gate_failures=0
SUMMARY: ae1c07db3622a6479582e66ecd37c55ddd27ea40 | unit={"passed":229,"failed":0,"skipped":0} parity={"goldens":3178,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":356,"failed":0,"flaky":0,"skipped":0} gate_failures=0
SUMMARY: bef905c1c1cbaa07165d8aac75634c6486e79537 | unit="not run" parity="not run" e2e={"passed":42,"failed":0,"flaky":0,"skipped":0} gate_failures=0
SUMMARY: a91ac1b87b76ebdd0a79203116abcc84c5cb6623 | unit="not run" parity={"goldens":3178,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":24,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

Quick summaries identify their starting HEAD, including working repairs subsequently committed. Their source bundles contain the repairs being checked; they are not full-gate verification stamps. The second cohort's line-25 selector does not select the new boundary fixture at line 24; the third cohort corrects that selection and passes both repetitions.

A focused production Windows cohort passes all 28 executions of the listed readiness, planning, checks, collaboration and slow-motion cases. It uses an isolated copy of the capture-fix build, before the palette and menu repairs, and is before evidence rather than a claim those native flakes were repaired. An unchanged geometry/replay cohort passes sixteen Windows Dev executions. These passes alone do not establish macOS or Windows native flake elimination.

Final lint, pnpm typecheck, format:check and pnpm exec prettier --check . pass before each signed commit. Lint retains eleven existing warnings and zero errors. No emitted JavaScript is produced in source.

Initial errors are retained as experimental evidence: the dependency guard requires a frozen install; one anchored grep finds no tests; the line-25 selector misses the new fixture; an experimental DOM attribute-read marker is invisible to Playwright's isolated-world reader and fails all three runs at that fixture marker; lint catches an unused locator after its removal. The corrected fixture observes the driver's canvas-read request before releasing focus, passes three runs and fails with the old idle wait restored. Those failures and deliberate negative reversions are not counted as green verification. Renderer-fixture experiments are kept separate too: pausing playback between zooms passes six Windows and forty-two Linux executions but is rejected because it reduces continuous-playback coverage. Freezing time without waiting for wheel-end fails all six Windows cases; waiting only for viewport movement fails all six again because the chip frame is still pending. The accepted fixture waits for both real signals and keeps playback running. A concurrent Windows after-check returns busy (exit 75) while the Linux gate owns the worktree; its locks are not removed, and validation is serialized after that required gate. The final Windows and Linux results above are the accepted continuous-playback source.

## Scope and rejected changes

SVG export deadlines stay assigned to perf/svg-export-1. Neither lowzoom-review.spec.ts:52 nor the keyboard edge-navigation camera policy changes. AA colour-token changes are not justified by the accepted baseline or final native result: both light and dark relationship audits pass in each. The short-viewport latency case remains enabled and unchanged; a passing dispatch does not establish its open flake eliminated.

Fixed sleeps, larger budgets/deadlines/tolerances, new retries, skips or quarantines, console-error suppression and re-recording goldens were rejected. Waiting for live context publications to stop would hide the palette product bug; preserving the person's actual choice is the product repair. Unreproduced rendering, geometry, narration, focus and collaboration cases stay enabled and are not labelled proven clean-master failures. No server, TURN or tracker change is made.

No simulation, planning or stencil feature is added, so no showcase example is required. The capture, palette and menu-ownership release fragments have their own UX reviews and add no controls or chrome.

## First implementation dispatch and CI

[Dispatch 41310403881](https://github.com/latchkostov/diagrams/actions/runs/41310403881) tests the first five fixes at 0a7fa5f69be43296cc4b169de0d9fd04005b287c. Its Linux Dev priority cases both pass; Dev finishes with 3,293 passed / 1 failed / 50 existing skips. The remaining import-toast failure is separate. Windows finishes 3,309 / 20 / 15. Build x3 records 9,992 passed, zero assertion failures, 33 existing skips and seven unfinished executions after an interrupted shard (six AI-privacy and one relationships dev-only cases). macOS is partial. This superseded dispatch is cancelled to release native capacity for the final SHA, with completed artifacts retained. These are before observations, not the final verification table.

First PR CI passes static checks, all unit coverage, heavy tests, build/size/ZIP, parity, self-host packaging and benchmark gates. E2E 6/6 records 522 passed and one circuit-breaker failure; the sixth fix above addresses its explicit completion race. Two new Windows health-current observations are checked using only that spec twice on clean master: fourteen pass. Neither those observations nor the circuit-breaker failure is dismissed as proven pre-existing. Other full suites are not repeated on master.

## Second dispatch and completed PR CI

[Dispatch 41313411980](https://github.com/latchkostov/diagrams/actions/runs/41313411980) tests six repairs at ae1c07db3622a6479582e66ecd37c55ddd27ea40. Its Windows inventory completes with 3,314 passed / 16 failed / 15 existing skips and zero unfinished. Linux Dev completes with 3,294 / 1 / 50 and zero unfinished: both assigned priority cases pass again, while imports.spec.ts:911 fails its original toast assertion. The failed screenshot shows the imported 300-node diagram and its toast present after the assertion times out. A helper-waits-past-an-expired-toast explanation is not supported; this completion/rendering delay remains unresolved without raising the deadline.

The macOS inventory is partial and exposes the menu-ownership product bug above; the run is superseded and cancelled to free capacity for the final implementation. Scoped Windows verification of only tutorials-solutions-4.spec.ts:7 twice on clean master 706ae790629a1b668ef52a46a77d150377ca12b1 passes thirty executions (one worker on the 32-CPU host). An identical pre-existing route-by-address watch failure is not established.

PR CI 41313360285 and benchmark gates 41313360274 at ae1c07d complete successfully: all static checks, three unit-coverage shards and merged coverage, heavy tests, build/size/ZIP, parity, self-host packaging and all six E2E shards pass. This includes the circuit-breaker case repaired by the sixth commit. The seventh repair has its own final local 229 unit/reserve tests, build, size, full parity and 356 loaded browser executions before push, plus fresh PR CI and the final Native dispatch.

## Third dispatch and final application CI

[Dispatch 41316747450](https://github.com/latchkostov/diagrams/actions/runs/41316747450) tests the seven repairs at bef905c1c1cbaa07165d8aac75634c6486e79537. Windows completes at 3,314 passed / 16 failed / 15 existing skips, zero unfinished. Its completed low-zoom renderer trace identifies the finite-fixture cause above. Partial reports also retain large-import, Workbench toast geometry, slow-motion restoration, pointer-recipe menu lifetime and held-pan observations; none is labelled a proven clean-master failure. The run is superseded and cancelled for the final test-fixture repair, with completed artifacts retained.

PR CI 41316752615 and benchmark gates 41316752516 at bef905c complete successfully, including every static check, all unit coverage, heavy tests, build/size/ZIP, parity, packaging and all six E2E shards. That is the final application source. The eighth commit changes only the rendering test and its backlog fragment; its fresh CI 41319999012 and benchmark run 41319999007 both complete successfully. The ninth commit changes only connection-rule test setup and its backlog fragment; fresh CI 41323595330 and benchmark run 41323595343 both complete successfully at that exact source. Every static, coverage, heavy, build/size, parity, packaging and six E2E CI shard passes. The final Native run is dispatched at the same source.

## Fourth dispatch and final test setup

[Dispatch 41319992759](https://github.com/latchkostov/diagrams/actions/runs/41319992759) tests eight repairs at a91ac1b87b76ebdd0a79203116abcc84c5cb6623. Windows completes with 3,312 passed / 18 failed / 15 existing skips, zero unfinished. Both renderer cases now pass. Its firewall label evidence supplies the ninth cause above. This superseded run is cancelled only after the final source is pushed and dispatched, releasing native capacity while retaining completed artifacts. Remaining assertions are kept enabled.

## Final native unit and heavy checks

All twelve native unit/heavy jobs pass: three unit shards and three heavy shards on each of Windows and macOS. Fresh PR CI 41323595330 passes all twenty jobs, including six E2E shards. Benchmarks 41323595343 pass. These results test the implementation c726eb6ac; the final verification-record commit adds documentation only.

## Final dispatch report-only evidence

The separate Windows slow-motion teardown evidence job completes with eleven passed and one failed across three repetitions. The fitted pre-replay viewport restoration case at slowmo.spec.ts:327 fails once at its exact attribute assertion. The four existing evidence-only cases and their normal native exclusions are unchanged. This is unresolved evidence, not a new skip or a claimed repair, and is separate from the main E2E inventory.

```text
SUMMARY: c726eb6ac4842e57b658a60a1f196f59e0ed4848 | unit="not run" parity="not run" e2e={"passed":11,"failed":1,"flaky":0,"skipped":0} gate_failures=1
```

## Matched Windows inventory

The final Windows inventory retains every baseline case and adds exactly the four regressions above. All four pass; every original skip remains skipped. Of the sixteen baseline failures, fourteen pass and two fail in this dispatch. Eighteen formerly passing cases fail. The final total is 3,311 passed / 20 failed / 15 existing skips / zero unfinished. This is still unstable and is not a reduced aggregate failure rate. The complete failure list below is retained without claiming clean-master reproduction.

## Completed Linux inventories

The final dispatch completes Linux Dev at 3,296 passed / zero failed / 50 existing skips / zero unfinished, and Linux Build x3 at 10,005 passed / zero failed / 33 existing skips / zero unfinished. All eight Dev and twelve Build reports are present, with no report errors or interruption markers. Both assigned Dev priority cases pass: failed-download inline Retry and Continue export-for-audience without lifecycle console errors. The open short-viewport latency flake and separately owned SVG deadline investigation remain enabled and unchanged; this single passing inventory does not establish either flake eliminated.

## Native results

[Final Nightly 41323589959](https://github.com/latchkostov/diagrams/actions/runs/41323589959) tests c726eb6ac4842e57b658a60a1f196f59e0ed4848. All forty E2E reports are present. The workflow completes with a failure conclusion. The table counts E2E executions, separate from native units, heavy tests and report-only evidence. All 20,076 scheduled main-inventory executions are accounted for.

| OS / target    | Passed | Failed | Existing skips | Unfinished | Reports |
| -------------- | -----: | -----: | -------------: | ---------: | ------: |
| Windows        |  3,311 |     20 |             15 |          0 |     8/8 |
| macOS          |  3,327 |      8 |             11 |          0 |   12/12 |
| Linux Dev      |  3,296 |      0 |             50 |          0 |     8/8 |
| Linux Build x3 | 10,005 |      0 |             33 |          0 |   12/12 |

All baseline case identities are retained in every inventory. Exactly four browser regressions are added per inventory, twelve for Build x3; all additions pass. Existing skip identities are unchanged, not just their totals. No new skip or quarantine is introduced. All reports have zero flaky results, zero report errors and zero interruption markers. Passing cases in one dispatch do not establish open flakes eliminated.

Matched Windows: 14 of 16 baseline failures pass; 2 fail again; 18 formerly passing cases fail. These are observations from one dispatch, not a measured flake-rate reduction.

Matched macOS: 7 of 9 baseline failures pass; 2 fail again; 6 formerly passing cases fail. These are observations from one dispatch, not a measured flake-rate reduction.

## Remaining groups

Both Linux inventories finish with zero failed and zero unfinished. Both assigned Dev priority cases pass. The large-import toast and RTL coach observations from earlier branch runs also pass here and remain enabled; neither is claimed repaired by a new change. The SVG deadline work and short-viewport latency flake retain their separate scope.

### Windows: 20 observed failures

- `live-large.spec.ts:183`: live-large.spec.ts > live view on large diagrams > closing the capacity panel only reads Overview labels for the camera fit @500.
- `live-render.spec.ts:192`: live-render.spec.ts > live rendering, worker path > slow motion draws its dots and captions above the pills, over the frozen live view.
- `live-render.spec.ts:143`: live-render.spec.ts > live rendering, main path > a dot passing behind an edge label pill is drawn dimmed above it.
- `live-render.spec.ts:257`: live-render.spec.ts > live rendering, main path > a waiting note stops the march like pausing does (the sim clock stands still).
- `live-render.spec.ts:394`: live-render.spec.ts > live rendering stays off the main thread > the worker path draws nothing on the main thread and runs no endless animation while live.
- `drawing-basics.spec.ts:549`: drawing-basics.spec.ts > drawing basics > Alt-drag drags a copy away and leaves the original; a copy dropped on a node moves clear.
- `examples-picker.spec.ts:384`: examples-picker.spec.ts > copy notice stays clear of expanded stencil controls.
- `round13-polish.spec.ts:284`: round13-polish.spec.ts > Shift+box adds to the selection > Shift box preserves a selected edge (1280px, sheet: 672).
- `request-deadlines.spec.ts:256`: request-deadlines.spec.ts > the callout adds a timeout as one undo step (saved no-timeout override: true).
- `request-deadlines.spec.ts:284`: request-deadlines.spec.ts > simulation-only traffic withholds an unverified timeout and applies the next confirmed fix.
- `fit-settled.spec.ts:276`: fit-settled.spec.ts > Auto-layout fits its committed positions before the next font refinement.
- `fit-settled.spec.ts:659`: fit-settled.spec.ts > the canvas mutation observer disconnects after an interrupted animated fit.
- `requests-wait-owner.spec.ts:73`: requests-wait-owner.spec.ts > the callout and planner offer the same verified fix; keyboard apply names its simulation and Undo restores it.
- `requests-wait-ux.spec.ts:137`: requests-wait-ux.spec.ts > Scale on busy threads keeps selection, focuses the changed target, and supports the unit toggle from the keyboard.
- `sim-truth.spec.ts:439`: sim-truth.spec.ts > loss callout adds a broker DLQ in one undo step and exhausted messages reach it.
- `image-slices.spec.ts:623`: image-slices.spec.ts > a PNG encode error releases the canvas, reports the error and allows another export.
- `pools-busy-threads.spec.ts:66`: pools-busy-threads.spec.ts > planner offers Scale on busy threads for a waiting majority.
- `tutorials-keyboard-3.spec.ts:6`: tutorials-keyboard-3.spec.ts > circuit-breaker: keyboard solution plays through the real UI.
- `inspector-live.spec.ts:453`: inspector-live.spec.ts > connection Live shares breaker verdict, tiles and rows, with accessible light markup.
- `inspector-live.spec.ts:453`: inspector-live.spec.ts > connection Live shares breaker verdict, tiles and rows, with accessible dark markup.

### macOS: 8 observed failures

- `latency.spec.ts:384`: latency.spec.ts > overflowing latency details support pointer and keyboard scrolling in presentation.
- `examples-picker.spec.ts:384`: examples-picker.spec.ts > copy notice stays clear of expanded stencil controls.
- `i18n.spec.ts:1272`: i18n.spec.ts > right to left > Arabic mirrors the chrome, not the diagram.
- `tutorials-keyboard.spec.ts:38`: tutorials-keyboard.spec.ts > api-gateway: keyboard solution plays through the real UI.
- `tutorials-keyboard-3.spec.ts:6`: tutorials-keyboard-3.spec.ts > quick-add: keyboard solution plays through the real UI.
- `tutorials-keyboard-3.spec.ts:6`: tutorials-keyboard-3.spec.ts > kafka-topic: keyboard solution plays through the real UI.
- `tutorials-keyboard-4.spec.ts:6`: tutorials-keyboard-4.spec.ts > dots-and-sides: keyboard solution plays through the real UI.
- `tutorials-keyboard-6.spec.ts:6`: tutorials-keyboard-6.spec.ts > cache-aside: keyboard solution plays through the real UI.

### Baseline macOS priorities

- `zones-boundaries.spec.ts:313` — expected: dragging selected parent and child preserves nesting and undo/redo.
- `tutorials-solutions-3.spec.ts:7` — expected: study-payments: its solution plays through the real UI.
- `tutorials-handoff.spec.ts:61` — expected: keyboard-only completion reaches the sheet and starts the next lesson.
- `tutorials-keyboard-5.spec.ts:6` — expected: dependencies-2: keyboard solution plays through the real UI.
- `tutorials-keyboard-5.spec.ts:6` — expected: faults: keyboard solution plays through the real UI.
- `lowzoom-edge-edit.spec.ts:17` — expected: offset connection clicks keep menus, shaping and reconnection at 0.25.
- `tutorials-keyboard.spec.ts:25` — unexpected: api-gateway: keyboard solution plays through the real UI.
- `latency.spec.ts:384` — unexpected: overflowing latency details support pointer and keyboard scrolling in presentation.
- `tutorials-keyboard-6.spec.ts:6` — expected: import-and-review: keyboard solution plays through the real UI.

### Follow-up ownership and limits

Windows failures group into rendering/export/readiness (8), geometry/selection/layout (5), planning and verified-fix interactions (6), and keyboard replay (1). Its circuit-breaker failure is at the replay-card wait, keyboard-tutorial-driver.ts:371; it is not the native speed-input boundary repaired by the sixth commit. macOS has five keyboard replays still failing (api-gateway, quick-add, kafka-topic, dots-and-sides and cache-aside), two chrome-geometry cases (copy notice and Arabic menu alignment), and Home scrolling in latency details. Api-gateway, kafka-topic and cache-aside stop in the actual focus-owner wait, not the earlier idle wait. Quick-add remains on grow; dots-and-sides stops at the protected edge-selection rule. The menu-policy repair cancels the proven pending controller move, but does not establish that every menu-focus loss is eliminated. No unverified failure is dismissed as proven pre-existing: the scoped clean-master checks above all pass.

The report-only fitted slow-motion viewport failure remains separate (11 passed / 1 failed). Keep lowzoom-review.spec.ts:52 and the keyboard edge-navigation camera rule for the owner decision. Leave SVG export deadlines with perf/svg-export-1 and the short-viewport latency case enabled. The application is unchanged after bef905c; the verification-record commit adds documentation only. Final PR CI and benchmarks are successful at the exact tested implementation c726eb6ac.
