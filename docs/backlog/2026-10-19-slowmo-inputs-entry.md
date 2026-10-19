## Slow-motion entry can remain paused with Inputs open

The full Linux gate for `4543cb84f80114d9de36bd8a8be838406513fd5a`
failed `tests/e2e/slowmo.spec.ts:114` at line 121. After loading the paused
Black Friday simulation, opening Inputs, setting the traffic multiplier to 14,
and choosing slow motion from the source node's menu, `live-play` stayed
`data-state="paused"` instead of becoming `slowmo`. The run used 12 workers
and 12 CPUs; 1,797 other E2E tests passed. No reading-region arrow is pressed
before this assertion.

```text
SUMMARY: 4543cb84f80114d9de36bd8a8be838406513fd5a | unit={"passed":12212,"failed":0,"skipped":4} parity={"goldens":2712,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":1797,"failed":1,"flaky":0,"skipped":0} gate_failures=1
```

Only `slowmo.spec.ts` was then run twice against a fresh Linux archive of
clean `origin/master`, at `354b5dd0b12771d1fc4c16a51285ea810cbf55a4`,
with the same worker/CPU counts. Both 17-test runs passed. The failure's
pre-existing status is therefore **unproven**, and its root cause remains open.

```text
SUMMARY: 354b5dd0b12771d1fc4c16a51285ea810cbf55a4 | unit="not run" parity="not run" e2e={"passed":34,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

Investigate slow-motion entry readiness with Inputs open under broader load;
retain the exact state assertion and zero retries. The separate fault-style
and arrow-scroll fixes passed 200 runs per case and five affected/neighbour
repetitions (790 tests). No slow-motion or live-session implementation was changed.

## Follow-ups 13 investigation

A separate, deterministic Inputs race is now covered and fixed: a delayed rebuild could discard a newly started slow-motion capture. Capture now flushes the debounce and waits for a yielded replay before borrowing the engine. Unit regressions cover the origin and a later replay position; restoring the previous implementation makes the origin regression finish with slow motion off.

This does **not** establish the cause of the incident above. Its traffic-only change patches the existing run; the deterministic reproduction also changes dot scale to require a rebuild. Keep the original incident open until its failure can be observed with capture/rebuild evidence.

After syncing onto engine R2 (#204), the unchanged original Inputs/Apply fix browser test passed five Linux load repetitions with eight workers and eight CPUs, alongside the affected specs and camera, drawing, keyboard and inspector neighbours. The complete load sweep passed 925 tests, with zero failures, flakes or skips. No engine behavior, assertion deadline or retry policy changed.
