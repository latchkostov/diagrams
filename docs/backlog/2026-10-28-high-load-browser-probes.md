## Existing browser probes under eight workers on four CPUs

The P2 batch's Linux run found these existing failures. All three reproduce on a clean checkout of `origin/master` at `b65664666f2669b8fecfd1c2fce9c48d058d81a0`, using only `bench-harness.spec.ts` and `lazy-live-fixes.spec.ts`, with `--linux --workers 8 --cpus 4 --repeat 2`:

- `zoomed-out Overview keeps every node silhouette reachable below the text floor`: the whole-test 30-second backstop expires during canvas readiness/geometry reads.
- `benchmark fits an off-pane card through the app before clicking it`: the same whole-test backstop expires during canvas readiness.
- `pending script download freezes live controls and says so; Esc gives them back`: after the cancelled module arrives, `live-play` is already `done` rather than the asserted `playing`.

Clean-master result:

```text
SUMMARY: b65664666f2669b8fecfd1c2fce9c48d058d81a0 | unit="not run" parity="not run" e2e={"passed":29,"failed":5,"flaky":0,"skipped":0} gate_failures=2
```

The same two specs at four workers/four CPUs passed both repetitions on clean master (34 passed) and on the branch (36 passed, including its new reset regression). Keep the original 100-part geometry probes and assertions. Investigate their repeated readiness work and the lazy-Live test's real-clock completion signal separately; do not add retries or increase timeouts.

The new reset correctness test uses 16 parts because its second page load tests persisted geometry/selection reset, not scale. Its assertions still fail when reset is disabled. The benchmark measurement workloads are unchanged.
