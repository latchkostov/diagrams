## Unclassified full-gate UI timing failures

The R1 review-fix full Linux gate ran on
`d0c42792ad82e4c8314c2512f2fab31c8d64a86a`, before master advanced, with six
workers, six CPUs, ports 6750–6754 and zero retries. It passed static checks,
12,254 unit tests, build/size and all 2,712 unchanged output goldens, then failed
two Chromium cases among 1,798 E2E cases:

- `record.spec.ts`: `failEncoder: failure stops capture and permits retry`
  exhausted its six-second poll for the fake recorder's `started` flag.
- `requests-wait.spec.ts`: `the trouble fix updates the active waiting override
and undo restores playback` exhausted the whole-test 30-second backstop. Its
  trace includes 12.7 seconds in the 11-second fake-clock playback, followed by
  the expected fix/undo interactions; it timed out before completing playback.

Exact full-gate summary:

```text
SUMMARY: d0c42792ad82e4c8314c2512f2fab31c8d64a86a | unit={"passed":12254,"failed":0,"skipped":4} parity={"goldens":2712,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":1796,"failed":2,"flaky":0,"skipped":0} gate_failures=1
```

## Targeted checks and remaining work

The only clean-master comparison was both affected spec files, repeated twice
with six workers and six CPUs in Linux. All 58 cases passed on
`86529d14e6e9f44d7492b4bdfcd6508f1c35e4e4`. That master has the same simulation
engine as the original trace baseline, `354b5dd0`. These results do **not** prove
the full-gate failures pre-exist on master.

After syncing the branch, both files passed five Linux load repetitions on
`a85d80788689232637d7c3c6217ed55793ae00a3`: 145 passed, zero failed or flaky,
again with six workers and six CPUs. The rebased engine also passed 163 focused
tests, including its properties, and all 2,606 node goldens were unchanged.

Investigate deterministic recording countdown control and the wall-clock cost
of the request test's scripted playback under full-suite load. Preserve the
start, retry, active override and undo assertions; do not label the failures as
confirmed pre-existing or waive the failed full gate based on isolated passes.
The requested verification-budget/full-gate precedence decision remains pending.
No production UI code, affected UI tests or output goldens were changed for these
failures. Reports remain in `tests/.output/g/rG3nPop`, `r2p0adg` and `rEfRAa5`.
