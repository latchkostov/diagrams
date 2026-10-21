## Full-gate slow-motion entry failure

The PR 4 Linux full gate at `2f4d6d56ba1eea0cbbcee7cfe6f5cc630bd08138`
passed static checks, unit coverage, builds, size and both parity tiers. Of 1,913
browser tests, only `tests/e2e/slowmo.spec.ts:114` failed. At line 121,
`live-play` remained `data-state="paused"` instead of `slowmo` after opening
Inputs in the paused Black Friday scenario, changing the traffic multiplier to
14 and choosing slow motion from the source node. The run used 12 workers and
12 CPUs, with zero retries. No slow-motion implementation or test was changed.

```text
SUMMARY: 2f4d6d56ba1eea0cbbcee7cfe6f5cc630bd08138 | unit={"passed":13398,"failed":0,"skipped":4} parity={"goldens":2897,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":1912,"failed":1,"flaky":0,"skipped":0} gate_failures=1
```

## Bounded master comparison

Only `slowmo.spec.ts` was run twice against a clean Linux archive of
`origin/master` at `4762486a0ac71218db08b4232f1b0990ad931390`, again with
12 workers, 12 CPUs and zero retries. Both 17-test repetitions passed. This does
**not** establish the failure as pre-existing or reproduce whole-suite load.
No full master suite was run. The verification-budget instruction calls for
recording this bounded result and continuing to push, rather than repeating
full suites. The follow-up commit records this evidence without changing code.

```text
SUMMARY: 4762486a0ac71218db08b4232f1b0990ad931390 | unit="not run" parity="not run" e2e={"passed":34,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

## Follow-up

Investigate entry readiness and capture state with Inputs open if CI repeats
the failure. Preserve the exact state assertion, zero retries and existing
backstops. Earlier observations are recorded in
[the Inputs-entry follow-up](2026-10-19-slowmo-inputs-entry.md) and
[deadline verification](2026-10-20-deadline-gate-browser-followups.md).
No causal fix, assertion relaxation or timeout increase is claimed here.
