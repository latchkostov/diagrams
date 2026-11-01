## Baseline and scope

Master Nightly [41346662217](https://github.com/latchkostov/diagrams/actions/runs/41346662217), source 5c22a5d42846b57a2dd3fe598a329a0af2f6441b, is the newest completed baseline at task start. All Linux jobs pass. Native reports record Windows 3,319 passed / 19 failed / 15 existing skips / zero unfinished and macOS 3,328 passed / 9 failed / 11 existing skips / five unfinished. The macOS fifth shard reaches its action deadline and retains its checkpoint; unfinished cases are not counted as passes.

The downloaded failing-job reports group as follows:

- Windows: phone selection loses the next edit; AI Undo restores a hidden node; one held-verification request; replay/Continue and keyboard readouts; worker caption capture and slow-motion captions; offline HTML playback deadlines; initial Live particle readiness; a room Inputs handoff; relay fixture setup; browser-command/teardown stalls.
- macOS: mixed boundary drag, latency Home scrolling, study-cells grouping, keyboard focus ownership, and the protected edge-navigation/camera cases. The fifth shard has unfinished work rather than an invented test failure.
- Linux Dev and Build x3: zero failed jobs in the accepted baseline. The earlier contrast, Lab and low-zoom export failures do not recur here. Both relationship AA audits pass, so there is no evidence for a colour-token change. SVG profiling and rejected optimizations remain documented in the existing SVG research fragment; no deadline or export test is changed here.

## Product repair: selection reveal

The phone selection failure reproduces on native Windows. Waiting for interaction and camera idle makes the failure consistent: the selected Receipt subscription is hidden behind the Properties sheet, focus is body, and ArrowRight cannot create an edit. The camera journal records a completed selection reveal; this is incorrect geometry, not a missing wait. `revealPan` checked the entire root rectangle while frame clipping used `visibleCanvas`.

The repair uses the exposed rectangle for both the reveal and overlay avoidance, preserving zoom. It also respects Focus/Follow's inner clipping frame and existing badge space. All four added geometry regressions fail with the original implementation temporarily restored (35 existing tests pass), and the real phone regression fails at node visibility on the unchanged production build. The exact fixed bytes are restored and hash-checked after the negative run; all 39 geometry tests then pass. Driver-only waits and a synthetic driver test are discarded. The original showcase test is unchanged.

The first geometry-only Linux experiment passes the original showcase case twice but fails the new settled-node regression twice. Its trace proves the remaining geometric mismatch: the body ends at screen y=360, but its 32 px badge space exceeds the inner frame's bottom at y=388 by four pixels. The completed repair places the whole footprint inside the existing clipping bounds, including when the body already clears the sheet. It does not loosen clipping. The phone regression and original showcase case then pass both Windows executions. The earlier experiment is not counted as green validation.

## Local verification

The completed product source passes full parity: 3,178 goldens, zero changed, added, missing or stale. The final geometry corpus has 39 passing tests, including the exposed-dock, clipped-footprint and oversized-centering cases. The final Linux unit phase passes 74 targeted cases, including all 30 startup/reserve heavy tests and the fragment checks; production build and size pass.

The final Linux container gate runs the phone regression, original phone showcase and the annotations, drawing-basics, round4-polish, viewport, platform and inspector neighbours five times, with six workers sharing four CPUs. All 505 executions pass without failures or flakes. Its exact summary (the source is uncommitted on the stated starting HEAD):

```text
SUMMARY: 5c22a5d42846b57a2dd3fe598a329a0af2f6441b | unit={"passed":74,"failed":0,"skipped":0} parity={"goldens":3178,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":505,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

A broader intermediate reservation shifted six oversized Tidy views by two pixels: the layout goldens for aws-serverless-orders, black-friday-commerce, cell-based-bookings, delivery-dispatch, ev-charging-network and hybrid-enterprise-network. Their viewport movement also changed projected label placement, clipping or typography. Those changes do not help a selection too large to fit, so the established vertical centering fallback is retained. No golden is updated. The intermediate run is cancelled through its owned Docker container; its outer gate reports the missing final summary after interruption, and its normal cleanup removes the container. It is not presented as a passing gate. Final parity matches every golden again.

Initial unchanged Windows cohorts pass 21 unconstrained and 30 four-CPU/three-worker executions. They do not reproduce or establish elimination of the native flakes. The later settled-phone reproduction supplies causal before evidence. An unsupported quick-gate `--grep` invocation runs no checks; scoped line selectors and direct Playwright are used afterward.

The final Windows production-build cohort passes 32 executions (two repetitions, three workers, four-CPU affinity, zero retries): the new phone regression, original phone showcase, AI Undo, presentation latency scrolling, mixed-boundary toast settlement and the unchanged keyboard-3 cohort. Passing reruns of the other cases are not claimed as repairs. Final lint, typecheck, format check and repository-wide Prettier check are required immediately before the signed commit.

No timeout, tolerance, budget, retry, new skip/quarantine, server, TURN, tracker, plugin version, protected low-zoom review or keyboard edge-navigation rule changes. Work stays in this checkout; no stash, rebase, force-push, merge or other-worktree operation is used. Final dispatched results and remaining groups will be recorded separately from local checks.
