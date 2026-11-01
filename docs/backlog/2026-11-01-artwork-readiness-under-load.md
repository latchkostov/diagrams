## Investigate artwork readiness under extreme browser contention

The P2 batch's exploratory Linux run at six workers/two CPUs encounters two failures in
`stencil-icon-loading.spec.ts`'s existing visible-image readiness predicate. That mixed 30-repeat
selection is interrupted. Reports and traces are retained in `tests/.output/g/rGJHvVn`.

A fresh `git archive origin/master` source export of bdbce520e, with its own frozen dependency install,
reproduces the identical predicate failure in **both repetitions**. Only the original artwork spec and
the two overflowing latency cases run: the latter provide the same parallel browser load and pass
all four executions. This snapshot stays inside this workspace; no other worktree is used. Reports:
`tests/.output/p2-master-clean/tests/.output/g/rj5hv3C`.

```text
SUMMARY: bdbce520e93460976997e59144070912ce8131c4 | unit="not run" parity="not run" e2e={"passed":4,"failed":2,"flaky":0,"skipped":0} gate_failures=1
```

The completed final four-worker/four-CPU cohort passes both repetitions of production and dev artwork
coverage, with its original readiness assertion and its original upper bound intact. Restoring the
old URL filter separately fails at the new dev request-count lower bound, which is a different gap.

Inspect network/decode/IntersectionObserver delivery before changing the app or driver. Do not raise
a timeout, loosen visibility or request bounds, or add retries. The low-risk P2 batch leaves this
separately reproduced master failure for follow-up.
