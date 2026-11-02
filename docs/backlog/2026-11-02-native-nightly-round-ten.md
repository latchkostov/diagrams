## Accepted baseline and grouping

Round 9 Nightly [41413744689](https://github.com/latchkostov/diagrams/actions/runs/41413744689)
tests 2c2033fe1. Complete downloaded native reports record Windows 3,326 passed, 14 failed,
15 existing skips and zero unfinished; macOS 3,336 passed, four failed, 11 skips and four
unfinished. Linux Dev has 3,305 passes, zero failures/unfinished and 50 skips; Build x3 has
10,032 passes, zero failures/unfinished and 33 skips. These are baseline counts, not branch results.

Recurring groups remain distinct: keyboard/quick-add and tutorial replay; presentation Home;
Live/capture/watch readiness and command stalls; planner/readout readiness. Windows trace-label,
held-paint and DLQ observations are not established flake rates. Round 8's annotation loss and
round 9's Inspector focus bug are already fixed upstream and pass this baseline.

## Controlled keyboard diagnosis

macOS api-gateway sends Orders immediately after a quick-add pick and remains at add-orders.
Chromium direct insertion on a focused noneditable canvas emits no keydown, beforeinput or input.
The name capture therefore cannot receive it. The controlled held-measurement browser case fails
the exact saved-name assertion with the original driver and passes after sending character keys.
This is a driver correction, not evidence of an application lost-edit bug for ordinary keystrokes.

The original Windows latency and keyboard-0/5/6 cohort passes its first 65 executions, three workers.
A second 65 executions also pass while the driver is being edited; they are not assigned a before/after
rate. Neither observation establishes a natural flake-rate improvement.

## Four unfinished macOS cases

Shard 7's workflow step reaches its unchanged 25-minute limit. Its checkpoint contains 281
completed tests consuming 1,430.072 seconds, with no failure and a maximum individual completed
duration of 24.807 seconds. Its final started case is the long-run Checks typing measurement;
relay sharing and the two dev StrictMode Checks cases have not started. The partial report has
no completed-test evidence of a hang. Do not count these four as passes or infer that the relay hung.

The Linux-derived file weights understate native wall work. A separate profile uses the 23
complete macOS reports from this run and the earlier round-9 dispatch. Using the current inventory
and the same mean fallback for unmeasured files on both plans, the largest old assignment estimates
1,341.9 seconds; native-weighted redistribution estimates 1,121.1 (ratio 0.835). These are planning
estimates, not an observed improvement. Interrupted reports are excluded. Test inventory,
repetitions, workers, shard count and deadlines stay intact.

## Still investigating

The study-payments menu observation is consistent with the independently reproduced palette
ownership bug below; a passing rerun alone does not establish that every observation shares it.
The load-shedding trace shows the driver's selection departure described below. Presentation Home
ends at 39 px after Home is delivered; its exact assertion stays enabled. Windows capture/live/watch,
brownout/replay, planner disclosure, held-paint, DLQ and trace-label cases remain enabled.

## Keyboard input verification

The controlled naming regression fails again when only the driver correction is temporarily
reverted, at the unchanged saved-name assertion. The exact fixed file is restored afterward.
The corrected case passes natively; the affected naming and keyboard-0/5/6 specs pass twice in
Linux with four workers sharing three CPUs. All 32 startup/reserve heavy checks are among the
160 passing focused units. Build and size pass; all 3,178 parity goldens remain unchanged.
Five fragment checks also pass. No golden is re-recorded.

```text
SUMMARY: 12c1bbd4e2629ead61cc461c81df364ab47ec830 | unit={"passed":160,"failed":0,"skipped":0} parity={"goldens":3178,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":120,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

This quick gate tests working edits on the stated starting HEAD, not a committed-head stamp.
An exploratory direct command was stopped during unused-server startup before any test ran;
the subsequent native regressions explicitly select Chromium and stop their own servers.

## Product repair: a palette destination leaves quick-add open

An ordinary Windows sequence reproduces the ownership bug: open quick-add, open Ctrl+K and go
to a node. The palette closes but quick-add remains and its camera hold stays deferred. Both
navigation to the current node and navigation to another node fail the exact menu-absence check.
Close the old menu through the interaction controller before deciding the palette's focus move.
Both native cases pass with the repair, including the next Alt+arrow. Three controller regressions
also fail when only the repair is temporarily reverted; all 107 controller tests pass when restored.

The affected palette specs and annotation, drawing, polish, viewport, platform and Inspector
neighbours run five times in Linux, six workers sharing four CPUs. All 570 executions pass.
The unit cohort passes 229 cases, including all 32 startup/reserve heavy checks. Build, size and
regeneration/i18n pass; full parity keeps all 3,178 goldens unchanged. No golden is re-recorded.

```text
SUMMARY: 818ea1dae5826dabb2cc67431a753c39ea7b58ea | unit={"passed":229,"failed":0,"skipped":0} parity={"goldens":3178,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":570,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

This quick gate likewise tests working edits on its starting HEAD.

## Driver repair: reaching fields without changing their subject

The macOS load-shedding trace uses Shift+Tab from API's Label, passes through the canvas, and
ends on Client's source settings. Canvas focus correctly moves selection with it. The requested
queue disclosure belongs to API, so waiting longer cannot repair this route. The driver's
shortest cyclic path must not cross the canvas when both endpoints are in the current Inspector.
Use their direct document-order route, with ordinary Tab/Shift+Tab, and retain global navigation
for other surfaces. No product Tab or selection rule changes.

The controlled forward and backward browser cases reach a same-named target but count one
canvas focus entry with the original route. Both fail again when the correction is temporarily
reverted, and both pass with zero entries when restored. Windows also passes api-gateway,
study-payments and load-shedding twice each. Those six passes are validation, not a measured
natural flake-rate improvement; the controlled regressions establish the route correction.

The new route cases, affected keyboard-0/5/6 specs, Checks simulations and relay sharing all pass
twice in Linux, six workers sharing four CPUs: 124 production plus four Dev executions. Every
formerly interrupted case finishes in both local repeats. The harness and fragment cohort passes
45 units. Application and output bytes are unchanged from the preceding product parity check;
no golden is re-recorded.

```text
SUMMARY: 1cacd30fb0461d7dbf3e68f4475bd13f176d339e | unit={"passed":45,"failed":0,"skipped":0} parity="not run" e2e={"passed":128,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

This subset runs working edits on its stated starting HEAD, including the native-profile harness.

## Native profile verification

The new timing profile is generated, not hand-edited. The existing Linux/Windows timing file is
byte-unchanged. Two new harness regressions fail with the original script temporarily restored:
one distinguishes the native and ordinary plans, and the other imports a complete native report
while excluding an interrupted child. The restored harness passes all 40 focused units; the final
Linux harness/fragment cohort passes 45. Its same-run browser subset above completes all four
formerly unfinished cases twice, without changing their source or limits.

At this implementation stage the hosted macOS outcome still needed the dispatched Nightly;
a local Linux pass was not recorded as proof that the native deadline was repaired.
The complete measurement provenance and refresh
command are in [the native shard fragment](2026-11-02-native-nightly-macos-shards.md).

## Completed branch dispatch

Nightly [41450369467](https://github.com/latchkostov/diagrams/actions/runs/41450369467), integration
`8d4ec6548`, completes all reports. Windows records 3,345 passed/19 failed; macOS 3,361/7;
Linux Dev 3,327/0 and Linux Build x3 10,104/0. Every suite has zero unfinished cases and flakes.
All five new browser regressions pass on both native OSes, and the four formerly unfinished
macOS cases all pass. Every macOS step finishes within the existing limit (maximum 22 minutes).
The green Linux Dev/Build streak holds. Native failures remain enabled; this is not a claim
that the native suite is green. See [the results and remaining groups](2026-11-02-native-nightly-round-ten-results.md).
