## Annotation failures during the waiting final UI load sweep

The rebased waiting fixes at `80beedcf` ran the affected requests, annotations, drawing, viewport, platform and Inspector specs with 12 Linux workers and 12 CPUs. The first repetition passed all 136 tests. The second passed 133 and failed three unchanged annotation cases:

- `annotations.spec.ts:256`: inline auto-growth and inspector text stay within persistence limits on reload; the 30-second whole-test backstop expired.
- `annotations.spec.ts:893`: cold Markdown keeps annotation geometry and image exports await the rendered text; the download event's 10-second action timeout expired.
- `annotations.spec.ts:1059`: canvas Tab visits annotation links before the next node; the first Markdown link did not receive focus.

The run was stopped after the second completed repetition to investigate. Waiting-request cases passed in both completed repetitions. An earlier interrupted run with eight workers on four CPUs also hit the text-growth backstop. A separate new multi-pill fixture initially lacked room for its second pill; that fixture now has a larger node gap, preserves both visibility/overlap assertions, and passes both blocking and non-blocking cases against a production build. Component regressions retain the original tight readout geometry and fail when its reservation is removed.

## Clean-master comparison

Only `annotations.spec.ts` ran on a clean local clone of `origin/master`, inside this checkout's ignored test-output directory, once with two repetitions and the same Linux worker/CPU counts:

```text
SUMMARY: e89c744631ff33978748dd256f95cd6b4f917ae9 | unit="not run" parity="not run" e2e={"passed":64,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

Identical reproduction on clean master is **not established**. Preserve the assertions and investigate load interference/readiness separately; no annotation implementation, assertion or timeout was changed here. Further broad repetitions and clean-master suites are deferred under the verification-budget instruction. The final branch still runs its one full Linux gate before push.
