## Shared-load timeout evidence during PR 247 recovery

Do not raise timeout budgets or weaken assertions to address these failures. The initial full unit run
reported 15,006 passed, eight failed, ten expected failures and ten skipped. One failure was the intended
webhook route snapshot, updated and verified separately (40 tests passed). The other seven were timeout
backstops: retry-storm evidence, retry-storm outcome seed 1, two Capacity-change planner cases, busy-thread
retry byte parity, and two git sync orchestration cases.

Only the failing files were exercised on an isolated archive of origin/master at
`4bdf5af7bf6653aad28deffca6c8601106aecaf3`, inside this worktree's ignored output. No full master suite ran.

- `checks/examples.test.ts`, `sim/scalingPlanner.test.ts`, and `examples/retry-storm.test.ts`: two runs
  reported 5 failed / 151 passed and 6 failed / 150 passed. Both reproduce the evidence and both planner
  timeouts; the second also reproduces outcome seed 1.
- `sim/retries.noop.test.ts`, `examples/retry-storm.test.ts`, and `lib/sync.test.ts`: two further runs
  reported 1 failed / 51 passed and 3 failed / 49 passed. Both reproduce the busy-thread byte-parity
  timeout. The second also times out at outcome seeds 42 and 99. Sync passed on master twice and on the
  focused branch rerun; its initial two timeouts are transient and are not claimed as identical master failures.
- Linux annotation stress tests at six workers on three CPUs reproduce the same two 30-second backstops
  on clean master: inline auto-growth/persistence at line 889 and adding all shapes from the canvas menu
  at line 955. Retain their persistence and interaction assertions. The recovery changes do not alter annotations.

The exact clean-master annotation summary is:

```text
SUMMARY: 4bdf5af7bf6653aad28deffca6c8601106aecaf3 | unit="not run" parity="not run" e2e={"passed":102,"failed":4,"flaky":0,"skipped":0} gate_failures=2
```

The third broader branch stress pass also missed `node-tooltip-doc` in the documentation-tooltip case
at line 1734. That case passed in both full annotation master repeats and both additional focused master
repeats (2 passed / 0 failed / 0 flaky); it is recorded as an unreproduced transient, not as a confirmed
master failure. No tooltip assertion or timeout was changed.

The complete five-pass branch neighbor run (six workers, three CPUs) finished with 703 passed, seven failed,
and zero flaky: three passes reproduced the two confirmed annotation timeouts, one pass missed the tooltip,
and the final pass passed all 142 tests. Its exact summary is:

```text
SUMMARY: 3ac537bd234c3e3add23b228916af5731952c8b4 | unit="not run" parity="not run" e2e={"passed":703,"failed":7,"flaky":0,"skipped":0} gate_failures=4
```

Investigate timeout sensitivity under shared host and container load independently of the message-picker
recovery. The five requested CI regressions retain their exact behavioral assertions, except the intentional
14-check agent count and the message pickers' new disclosure selector.
