## Terraform fit failure during the toast resume gate

The one full Linux E2E run of toast code commit `f7c35476d` passed 2,762 cases, failed one and
skipped one, with zero flaky cases. The failure was `tests/e2e/imports.spec.ts:820`,
“Draw everything is compact”: the fitted MSK card measured 107.85018920898438 px wide
against the unchanged `> 110` assertion.

The exact case then passed both focused Linux repeats on clean origin/master `c59c2127f`
and both focused Linux repeats on the toast branch. Both comparisons used two workers and
two CPUs. The full run used twelve workers and twelve CPUs. This does not establish a
pre-existing master failure or fix the intermittent full-run failure. Keep its assertion
and investigate camera/measurement settlement separately; no timeout or limit was changed.

Following the fix-round verification budget, no full suite was repeated.

## Exact summaries

```text
SUMMARY: f7c35476d652ba1feda7904739166f66e3eb08af | unit="not run" parity="not run" e2e={"passed":2762,"failed":1,"flaky":0,"skipped":1} gate_failures=1
SUMMARY: c59c2127fd6e0403df02c117a3f204f30e9328d7 | unit="not run" parity="not run" e2e={"passed":2,"failed":0,"flaky":0,"skipped":0} gate_failures=0
SUMMARY: f7c35476d652ba1feda7904739166f66e3eb08af | unit="not run" parity="not run" e2e={"passed":2,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```
