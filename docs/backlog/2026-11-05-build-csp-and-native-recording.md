## Complete Linux Build gate

The full gate on `8d918f46b1c3a7c7def6ca83c760c513eec2fb0d` used six workers
and eight CPUs. Docker smoke, static checks, coverage, heavy tests, build, size
and parity passed. The complete Build e2e suite finished with 3,433 passed,
two failed, zero flaky and twelve skipped cases. Report: `tests/.output/g/rcsPLce`.

```text
SUMMARY: 8d918f46b1c3a7c7def6ca83c760c513eec2fb0d | unit={"passed":16629,"failed":0,"skipped":13} parity={"goldens":3376,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":3433,"failed":2,"flaky":0,"skipped":12} gate_failures=1
```

## Bounded clean-master comparison

Only `record.spec.ts` and `csp.spec.ts` were repeated twice on clean master
`85bc26c10b4480177568cf98a9812e683225c7fd`, with the same Build target,
worker/CPU allocation and committed-source Linux snapshot. The first repeat
had 23 passed and five failed cases; the second passed all 28. Report:
`tests/.output/cdn5-master-baseline/tests/.output/g/rlHeY7u`.

```text
SUMMARY: 85bc26c10b4480177568cf98a9812e683225c7fd | unit="not run" parity="not run" e2e={"passed":51,"failed":5,"flaky":0,"skipped":0} gate_failures=1
```

The same CSP editor walkthrough failed at its first `node-shopper` click,
waiting for a visible, enabled and stable element for ten seconds. No CSP
violation was reported. Four additional CSP walkthrough timeouts appeared
only in the master comparison. The native recording case passed both master
repeats, so its feature-run failure is not claimed as pre-existing.

## Native recording fixture resolved

The failed take returned the unsavable-recording error. Its canvas and
application clock were controlled, while the browser's real encoder ran on
its own clock. The fixture now requests canvas frames explicitly and observes
nonempty native `dataavailable` output before Stop. It still uses the native
MediaRecorder and retains every duration, metadata and paused-clock assertion.
The production recorder is unchanged.

All five targeted Linux repeats passed with six workers and six CPUs: 75
passed, zero failed and zero flaky (`tests/.output/g/rDykW2a`). Temporarily
removing only the encoder synchronization from the controlled fixture fails
the real-codec metadata assertion: fourteen passed and one failed
(`tests/.output/g/rzjyo8p`). Synchronization was restored for the final check.
That restored check passed all fifteen cases with zero failed and zero flaky
(`tests/.output/g/ruXYKBk`).

## Follow-up

Stabilize the pre-existing CSP walkthrough readiness without weakening its
security policy or assertions. Keep this bounded master evidence separate
from the resolved native-capture fixture race. The full suite is not repeated
for the documentation and fixture-only follow-up; application code and all
3,376 parity goldens are unchanged from the complete gate above.
