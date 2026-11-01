## Final verification

Ready [PR #415](https://github.com/latchkostov/diagrams/pull/415), **Nightly: native browser failures, round 6**, implements the repairs through signed commit fdca9483c173b5fa2f4cf5ce881af7815a74b99d. [Final Nightly 41300989083](https://github.com/latchkostov/diagrams/actions/runs/41300989083) runs that implementation. This verification fragment changes documentation only.

| OS / mode      | Passed | Failed | Existing skips | Unfinished |
| -------------- | -----: | -----: | -------------: | ---------: |
| Windows        |  3,311 |     16 |             15 |          0 |
| macOS          |  3,322 |      9 |             11 |          0 |
| Linux Dev      |  3,290 |      2 |             50 |          0 |
| Linux Build x3 |  9,990 |      3 |             33 |          0 |

All forty browser reports complete, with zero flaky, unfinished, interrupted or report-error cases. Existing skips are unchanged. Each single inventory has 3,342 executions; Build has 10,026 across its three repetitions.

[Implementation CI 41300978027](https://github.com/latchkostov/diagrams/actions/runs/41300978027) is green: all six E2E shards, three unit-coverage shards, merged coverage, heavy tests, parity, build/size, self-host packaging and static checks pass. Native remains red; ordinary CI success does not establish that its remaining failures are repaired.

## Repairs and causal evidence

- **Search keyboard ownership:** a mounted search input keeps keyboard capture when its translated placeholder changes. The unit regression fails with the old effect dependency: Enter picks zero items instead of one.
- **Bracketed prose:** KeyText keeps multiword bracketed instruction prose wrapping instead of rendering one nonbreaking keycap. Explicit keys, nested combinations and the literal opening bracket are retained. Restoring the old parser fails the prose/nested-wrapper regressions. An old production build also fails the strengthened phone objective check: one false keycap instead of zero. Fourteen final parser units pass.
- **Menu publication:** after every arrow, the keyboard driver awaits the actual active-row publication before cycle detection. Holding real menu publications reproduces the old driver's early return. The fixed driver passes without changing keys, cycle checks or deadlines.
- **Saved naming revision:** the final quick-add snapshot uses the existing current-document autosave acknowledgement. The held-save regression fails with the old reader on Windows, returning Redis Cache instead of Cache audit.
- **Import visibility:** complete imports are inspected in Overview. The compose case first proves Focus hides its unrelated topic; removing Fit reproduces the native hidden-topic failure. The wide annotation import fits at 54.56%, where secondary text is intentionally hidden. After the camera acknowledgement and that hidden precondition, the real 100% command precedes the unchanged text assertions. The fit-only case fails once in three constrained Windows executions; the fixed case passes three. Removing only the 100% command deterministically restores the title failure.
- **Completed speed choice:** optional tutorial speed selection hands off through the existing CompletedStep only when the actual lesson has finished and restored normal speed. A real select fixture fails the old exact-8 assertion. The fixture and complete scale-on-backlog lesson pass two Windows repetitions. Required completion controls and all other select checks retain their assertions.
- **Lab distribution:** sixteen batches retain every cold navigation, preset, render/readout, title and console check. Before traces continue completing presets until the eight-batch deadline; no single stuck preset is established. All sixteen Windows batches pass both complete branch dispatches. In-place navigation was rejected because it removes independent cold-load coverage.
- **Focus observation:** the keyboard driver polls the same actual focus transition without the default polling gap. All keys, roving-focus frames, camera acknowledgements, cycle checks and assertion deadlines remain. A loaded study-fanout trace spends 10.25 seconds across 103 focus polls and reaches completion at the whole-test deadline. That lesson changes from one pass/one deadline to two passes locally; remaining native keyboard failures are still reported.

## Remaining Native groups

Windows has sixteen failures:

- Live/render/camera/planning readiness (6): live-large.spec.ts:235, pan-pointer.spec.ts:10, confluence-forge.spec.ts:346, latency.spec.ts:355, requests-wait-ux.spec.ts:137 and pools-busy-threads.spec.ts:66.
- Tutorial/keyboard/slow-motion (6): tutorials.spec.ts:2236 (author-a-simulation), tutorials-solutions-4.spec.ts:12 (export-for-audience), tutorials-keyboard-5.spec.ts:6 (capacity), tutorials-keyboard.spec.ts:25 (scale-on-backlog and retry-storm), slowmo.spec.ts:232.
- Checks scheduling (1): checks-ui.spec.ts:380 reaches its whole-test deadline waiting for pending work.
- SVG export (1): lowzoom-chips.spec.ts:229 reaches its whole-test deadline.
- Collaboration controls/progress (2): hosts-requests.spec.ts:83 and watch-together.spec.ts:144. No transport change is made.

Linux Dev has two failures: tutorials.spec.ts:1306 cannot find the failed-download Retry control, and tutorials-apply-present.spec.ts:204 export-for-audience reports two flushSync lifecycle console errors. Compose import and both phone orientations pass.

Linux Build has exactly three failures, all repetitions of lowzoom-chips.spec.ts:229. Both phone orientations and their original hit checks pass in every repetition, replacing the three phone failures in the complete before run. SVG deadlines remain open.

macOS has nine failures:

- Tutorial/keyboard replay (6): tutorials-solutions-3.spec.ts:7 (study-payments), tutorials-handoff.spec.ts:61 (grow-db), tutorials-keyboard-5.spec.ts:6 (dependencies-2 and faults), tutorials-keyboard.spec.ts:25 (api-gateway), and tutorials-keyboard-6.spec.ts:6 (import-and-review).
- Nesting/geometry (2): zones-boundaries.spec.ts:313 loses the group inspector after selected parent/child dragging, and lowzoom-edge-edit.spec.ts:17 cannot find reconnect at 25%.
- Home scrolling (1): latency.spec.ts:384 presentation stops at 17 instead of 0.

Both phone orientations and the expanded Read-note cases pass on macOS. Both original phone orientations therefore pass every platform, including all three Build repetitions, with the original hit assertion and stronger zero-false-keycap check. The protected lowzoom-review cases pass the final dispatch; its camera behavior and assertion are unchanged.

The final macOS presentation Home-scroll trace reaches scrollTop 0 immediately after Home, then moves to 7, 12 and 17 while the card geometry remains unchanged. This supports investigating late native scroll delivery after the existing gesture acknowledgement; it does not establish the cause. The exact-zero assertion remains unchanged.

The separate report-only Windows slow-motion evidence job passes nine and fails three: slowmo.spec.ts:80 live particles, :128 Inputs/capacity during playback, and :327 fitted viewport restoration. These additional diagnostic executions are not included in the main inventory table. Its exact summary is:

```text
SUMMARY: fdca9483c173b5fa2f4cf5ce881af7815a74b99d | unit="not run" parity="not run" e2e={"passed":9,"failed":3,"flaky":0,"skipped":0} gate_failures=1
```

These are observed failure groups, not established shared root causes. A single passing dispatch is not a claim of flake elimination. No new skip or quarantine is introduced.

## SVG deadlines remain unresolved

The original six-capture comparison fails all three simultaneous local Windows executions on two CPU cores. Sequential Linux repetitions pass. Each SVG is approximately 9.46 MB. Below 60%, export restores the complete natural drawing, and completed comparisons still match.

In the final Build shard 8 traces, setup before the first capture takes approximately 14-16 seconds. Both 40% captures complete and match, taking approximately 7.3-8.0 seconds per parallel page evaluation; both 25% captures complete and match, taking approximately 3.7-4.8 seconds. The whole-test deadline arrives around the final 100% zoom or capture. The zoom-poll failure has only about half a second of the whole deadline remaining; it does not establish a separate stuck zoom wait. Export-module network fetches take approximately 10-208 milliseconds. These are diagnostic observations, not new timing assertions.

A local profile identifies computed-style reads/writes and XML serialization as dominant capture work. Rejected experiments are fully restored:

- Alternate native property access is slower, and batching reads gives inconsistent gains.
- Mutable style templates reorder declarations and change serialized bytes.
- Full-value native-clone reuse preserves 967 measured declaration blocks and four complete paired SVGs after existing generated-id canonicalization, but total gains range from a regression to 18%. That does not establish a deadline repair.
- Native scheduler yielding and sequential scheduling of the same six captures each still fail all three constrained executions.

No export implementation change, serialized-byte change, deadline increase, tolerance or budget increase is shipped. This performance group remains open.

## Corrected phone diagnosis

Interim commit 13b6a3ed5 adds a hit-test wait and held-cover fixture. Its local cohorts pass, but Native 41298246610 still fails the phone case in Dev and all three Build repetitions. A macOS trace from the earlier complete dispatch shows the pseudo-locale sentence rendered as one oversized keyboard key, permanently overflowing horizontally. This is a parser bug rather than a settling delay.

Commit fdca9483c removes the wait and its fixture, restores the original single hit-test assertion, and adds the stronger zero-false-keycap assertion to the existing phone cases. The rejected wait is not part of the final diff. The interim dispatch is cancelled only after the parser fix is pushed and the final dispatch starts; its incomplete inventories do not verify the final code.

## Validation and exact summaries

Node 24.22.0, native Windows Chromium and the pinned Linux Playwright container; declared workers/CPUs, explicit owned ports and zero retries. No local full suite or full gate is queued in this fix round.

Full parity passes: **3,178 goldens, zero changed, added, missing or stale**. No golden is re-recorded. The parity bundle contains the final parser grammar. The final literal-bracket refinement passes fourteen parser units and all thirty startup/reserve heavy tests, a fresh production build and size check. The runtime spec passes both Linux repetitions with the original hit assertion (sixteen executions); both phone orientations pass two constrained Windows repetitions (four executions).

```text
SUMMARY: 13b6a3ed5f93077c2f2aa37d6d5e3415755c4632 | unit={"passed":47,"failed":0,"skipped":0} parity={"goldens":3178,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":16,"failed":0,"flaky":0,"skipped":0} gate_failures=0
SUMMARY: 13b6a3ed5f93077c2f2aa37d6d5e3415755c4632 | unit={"passed":44,"failed":0,"skipped":0} parity="not run" e2e={"passed":0,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

Quick-gate summaries name their starting HEAD, including working edits subsequently committed. The first unit phase predates the final literal-bracket refinement; its parity and browser bundle contain that final grammar. The second scoped gate rechecks the refinement's units, reserve tests and build/size. An overlapping attempt exits busy (75) behind this worktree's active gate; no live lock or sidecar is removed.

Earlier affected units pass, as do 48 quick-add Linux executions. A fresh loaded annotation/main-keyboard/neighbouring-sixth-keyboard cohort passes two repetitions with six workers/four CPUs:

```text
SUMMARY: 90877cddd27550902f8a0e8d1bb153ad50d68027 | unit={"passed":12,"failed":0,"skipped":0} parity="not run" e2e={"passed":184,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

The preceding combined Linux cohort is before evidence, not a green final verification. It passes 477 and fails annotation text twice and the completed speed choice once; it predates their repairs, and test sources change during that run:

```text
SUMMARY: 86ccc1e3209130e406c642da706670459f5e7e8f | unit={"passed":67,"failed":0,"skipped":0} parity="not run" e2e={"passed":477,"failed":3,"flaky":0,"skipped":0} gate_failures=2
```

Final lint, pnpm typecheck, format:check and pnpm exec prettier --check . precede every signed commit. Lint retains eleven existing warnings and zero errors. i18n reports zero errors. Initial invocations encounter missing dependencies, an unsupported gate argument and size checking before building; corrected invocations pass. A temporary reverted import check leaves its helper unused during a concurrent lint; the commit is blocked until restoration and the complete final static sequence passes. Deliberate negative regressions are recorded as failures, not counted as green runs.

## Baselines and isolated checks

Accepted baseline: [round-five Nightly 41276976443](https://github.com/latchkostov/diagrams/actions/runs/41276976443), source ff4fd545474c166b8c165bfef77ed8de1417c42c. Windows has 3,241 passed/14 failed/15 skipped; macOS 3,242/17/11; Dev 3,219/1/50; Build x3 9,775/2/33. All have zero unfinished.

Starting master b164fffa72ba41ee1eae75c0f7c52c163100c645 includes later tutorial work: 3,332 executions per inventory versus the accepted baseline's 3,270. The final repairs add ten browser executions: eight additional Lab partitions and one menu-publication and one completed-speed regression. The temporary held-cover fixture is removed. Final inventories contain 3,342 cases, or 10,026 across Build repetitions. Aggregate pass counts across the accepted baseline and final branch are not matched comparisons.

The completed eight-repair [before run 41294360339](https://github.com/latchkostov/diagrams/actions/runs/41294360339), source 8e530736c49be3c0fed5b5973aa926a5ed394efb, reports Windows 3,300 passed/27 failed/15 skipped; macOS 3,321/10/11; Dev 3,288/4/50; Build x3 9,990/3/33. All forty reports complete, with zero unfinished, interrupted, flaky or report errors. Its three Build failures are the phone case, while SVG deadlines still fail Windows and constrained local runs. All sixteen Windows Lab batches, annotation round trip, quick-add navigation, real recording and confirmed-fix persistence pass. These unchanged cases passing once are not labelled repaired by this branch.

Earlier diagnostic runs 41291279804 and 41293166949 are superseded and cancelled after later dispatches start. Their partial inventories are not final verification. The complete before run's read-a-node trace publishes the arrow destination and then resets the active row without another arrow; publication acknowledgement alone does not prove that separate command-refresh ownership cause repaired.

The before run adds two Dev Continue-reconstruction failures in tutorials-apply-present.spec.ts:204: export-for-audience reports flushSync lifecycle errors and study-rag remains on survive-reindex. These newer cases are absent from the accepted baseline. Only that spec is run once on clean origin/master with two Linux repetitions, then on the branch. Both pass all 46 cases, so identical pre-existing failures are not established:

```text
SUMMARY: b164fffa72ba41ee1eae75c0f7c52c163100c645 | unit="not run" parity="not run" e2e={"passed":46,"failed":0,"flaky":0,"skipped":0} gate_failures=0
SUMMARY: 8e530736c49be3c0fed5b5973aa926a5ed394efb | unit="not run" parity="not run" e2e={"passed":46,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

Interim CI 41298239219 fails one requests-wait.spec.ts:106 preview click (669 passed in that shard). Only that spec is checked once on clean origin/master, twice in Linux; all thirty pass. An identical pre-existing failure is not established. Final implementation CI is green.

```text
SUMMARY: b164fffa72ba41ee1eae75c0f7c52c163100c645 | unit="not run" parity="not run" e2e={"passed":30,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

Both isolated checks use only this worktree, restore the branch and saved edits immediately, and use no stash or other worktree. No full clean-master suite is run.

## Contrast, camera and scope

Both relationship AA contrast audits pass in light and dark in the final macOS dispatch, accepted baseline and complete eight-repair dispatch. No speculative colour-token change is justified. The existing short-viewport latency case (now latency.spec.ts:246) passes Windows, macOS, Dev and all three Build repetitions in the final dispatch. It remains unchanged and enabled; one passing dispatch does not establish its open flake eliminated. The below-60% keyboard edge-navigation policy and lowzoom-review.spec.ts:52 remain untouched pending the owner decision; any observed failure is reported without changing the assertion.

No new skip, quarantine, timeout, tolerance, budget, retry, server, TURN, tracker, plugin-version or schema change. No simulation, planning or stencil feature is added; no new showcase example is required. Every commit is signed as latch.kostov@gmail.com and pushed normally after signing. No stash, rebase, force push, merge or other-worktree operation is used. Master remains at the starting SHA when the implementation is pushed.
