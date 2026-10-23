## Checks ignore/export/import whole-test timeout

During PR #247's message-loop quarantine verification, the first of three Linux browser repetitions
hit the existing 30-second whole-test backstop in `tests/e2e/checks-ui.spec.ts:178`:
**Ignore keeps its reason through reload, export and import, and Show again brings it back**.
The trace shows the final row-visible and warning-count assertions completed before the timeout.
The same spec passed in repetitions two and three; every message-types test passed in all three.
No timeout, timing assertion, selector or product behavior was changed to make this pass.

The broader branch run used six workers and six container CPUs:

```text
SUMMARY: 50ee144f6d3ef4c6b8489c76c0f8db23b4b51481 | unit={"passed":15046,"failed":0,"skipped":10} parity="not run" e2e={"passed":167,"failed":1,"flaky":0,"skipped":0} gate_failures=1
```

Only the failing spec was then run twice on a clean checkout of origin/master, inside this worktree's
ignored output directory, with the same six workers and six CPUs. Both passed. This does **not**
establish an identical pre-existing master failure; retain it as an unreproduced transient.

```text
SUMMARY: 6637eecf42cf9751f8b9834a47f01571d120ee81 | unit="not run" parity="not run" e2e={"passed":26,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

If CI reproduces it, inspect total setup/reload/export/import/teardown work under concurrent browser
load before changing the backstop. Keep the persistence, import and restoration assertions intact.
