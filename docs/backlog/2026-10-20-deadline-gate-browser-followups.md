## Unconfirmed browser failures during deadline verification

The first full Linux gate at `a5aa7dce0edaabbdde9941013730138ebfb4cb80`, with 12 workers
and 12 CPUs, passed 1,867 browser tests and failed four:

- `sharing-privacy.spec.ts:172`: the dialog-close test exceeded its 30-second hang backstop.
- `slowmo.spec.ts:114`: the Inputs-panel case remained paused instead of entering slow motion.
- `csp.spec.ts:135`: the recording preview did not appear; no CSP violation was reported.
- `checks-ui.spec.ts:338`: the typing comparison exceeded its 120-second hang backstop.

All six `request-deadlines.spec.ts` cases passed. The same gate passed 13,261 unit checks,
with one skill-ZIP budget failure and four skips, and compared 2,779 goldens without differences.
The ZIP failure is fixed separately without raising its limit. The candidate was superseded
by the required master sync and packaging fix, so it received no verification stamp.

Only the four affected specs were then run twice on clean current master
`094515c05566fb61a99d808fe45a727a001a7067`, in an isolated checkout inside this workspace,
under Linux with 12 workers and 12 CPUs. Both repetitions passed all 48 tests. The original
failures are therefore unconfirmed and are not classified as pre-existing. No assertion or
timeout was relaxed. Investigate their traces if CI repeats them.

```text
SUMMARY: a5aa7dce0edaabbdde9941013730138ebfb4cb80 | unit={"passed":13261,"failed":1,"skipped":4} parity={"goldens":2779,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":1867,"failed":4,"flaky":0,"skipped":0} gate_failures=3
SUMMARY: 094515c05566fb61a99d808fe45a727a001a7067 | unit="not run" parity="not run" e2e={"passed":96,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```
