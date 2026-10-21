## Investigate long-note and evidence test load sensitivity

During PR #213 follow-up verification, a Windows unit run with two workers reported 13,144 passed, four skipped and one timeout: `src/checks/examples.test.ts`, simulation evidence for `blocking-call`, exceeded its existing five-second backstop. The focused branch rerun passed all 142 tests, including geometry and bundle checks. Two isolated runs of the evidence spec on clean master `d217d057fb162fdb1e98eeff064932e5353836ef` each passed all 96 tests (including type tests). The timeout did not reproduce there.

The Linux neighbour run at six workers on four CPUs also timed out in `inline auto-growth and inspector text stay within persistence limits on reload`. A clean-master annotations reproduction, twice with the same worker/CPU configuration, passed all 68 cases:

```text
SUMMARY: d217d057fb162fdb1e98eeff064932e5353836ef | unit="not run" parity="not run" e2e={"passed":68,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

Retain these observations for a focused harness investigation; neither timeout is claimed to reproduce on master. No assertion or timeout was relaxed. The branch-only exhaustive shape-stroke test also hit its backstop: its duplicate browser geometry sampling was removed, retaining every sample and the same tolerance.
