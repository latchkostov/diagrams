## Existing hover-card focus failure observed during sampling 8b

Sampling 8b changes engine code and engine tests. Its CI [E2E shard 5](https://github.com/latchkostov/diagrams/actions/runs/40196478734/job/121178544297) passed 397 tests, skipped one, and failed `hover-cards.spec.ts` → `removing a focused node readout target recovers canvas focus`. After Delete and Undo in paused Live, the restored target exists but its forced hover does not reopen `node-detail-caller`; the unchanged assertion expects `data-pinned="false"` and finds no element.

## Clean-master evidence

The scheduled [Nightly on master](https://github.com/latchkostov/diagrams/actions/runs/40162391112) used commit `3234a45b07e1caeb2c7670e6da4857ef6725a809`, an ancestor of the branch's current master base. Its [dev-server job](https://github.com/latchkostov/diagrams/actions/runs/40162391112/job/121076482596) records this identical post-Undo assertion and missing readout. The [native Windows job](https://github.com/latchkostov/diagrams/actions/runs/40162391112/job/121076482667) also lists this test among its five failures:

```text
SUMMARY: 3234a45b07e1caeb2c7670e6da4857ef6725a809 | unit="not run" parity="not run" e2e={"passed":380,"failed":5,"flaky":0,"skipped":0} gate_failures=1
```

One targeted clean-master check was run from a tracked-source archive of `e2f5a4825959d0e0d634ef4a97beec59167c28c6` inside the sampling workspace, using the existing Linux runner, the whole affected spec, two repeats, three workers/CPUs, and reserved ports 6770–6774. Both repeats passed; this is not a local reproduction of the intermittent failure:

```text
SUMMARY: e2f5a4825959d0e0d634ef4a97beec59167c28c6 | unit="not run" parity="not run" e2e={"passed":84,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

## Follow-up

The product/focus lane owns the intermittent post-Undo hover behavior, already listed in [Nightly triage](2026-10-25-nightly-triage.md). Preserve the focus and pinning assertions. Sampling 8b does not alter the UI or its tests to work around this upstream failure; no assertion, timeout, or test scope was loosened. No full clean-master suite was rerun.
