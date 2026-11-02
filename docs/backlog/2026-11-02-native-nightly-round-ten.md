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

The Linux-derived file weights understate native wall work. A diagnostic plan using the 23
complete macOS reports from this run and the earlier round-9 dispatch estimates the largest
existing assignment at 1,255.2 seconds; native-weighted redistribution estimates about 1,110.
These are same-measurement planning estimates, not an observed improvement. Interrupted reports
are excluded. Test inventory, repetitions, workers, shard count and deadlines must stay intact.

## Still investigating

The macOS study-payments menu and load-shedding queue-details failures need their actual transition
states retained; the keyboard name correction does not claim to fix them. Presentation Home ends
at 39 px after Home is delivered; its exact assertion stays enabled. Windows capture/live/watch,
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
