## Browser failures during Nightly workflow verification

The one full native gate for the Nightly workflow change ran with 12 workers on Windows/Node
24.22.0. Its application code and browser specs were unchanged from `origin/master` at
`63fba7a708937297ef662e723e8600885fd15b87`. Three Chromium cases failed:

- `bench-harness.spec.ts`: **zoomed-out Overview keeps every node silhouette reachable below the
  text floor** exhausted its 30-second whole-test backstop while `Bench.selectionSettled()` waited
  for the Inspector to leave `data-collapsed="1"` after selecting a node.
- `firstrun.spec.ts`: **first run › New diagram keeps unsaved content, extension metadata included,
  across reload** exhausted the same backstop waiting for the JSON download in `exportedJson()`.
- `ux-resilience-followup.spec.ts`: **timeline events form one roving keyboard stop and retain
  pointer access** observed zero markers with `tabIndex === 0`, where it expected one (line 124).

Full-gate result (local reports: `tests/.output/g/rP9Eajq`):

```text
SUMMARY: 49440119903ff8b9dc6c4507a9ab126689ecb82f | unit={"passed":14140,"failed":0,"skipped":13} parity={"goldens":3178,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":2866,"failed":3,"flaky":0,"skipped":5} gate_failures=1
```

A clean detached checkout of that exact `origin/master` commit, inside this checkout's ignored
test output, ran only the three failing specs. No other worktree was used. Command:

```text
pnpm gate quick tests/e2e/bench-harness.spec.ts tests/e2e/firstrun.spec.ts tests/e2e/ux-resilience-followup.spec.ts --only e2e --repeat 2 --workers 12 --ports 6860 --max-wait 1
```

Both repetitions passed (local reports: `tests/.output/nightly-master-proof/tests/.output/g/rQvLi4z`):

```text
SUMMARY: 63fba7a708937297ef662e723e8600885fd15b87 | unit="not run" parity="not run" e2e={"passed":52,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

These failures are not confirmed clean-master reproductions. The isolated passes do not establish
why the full run failed. Retain the full-run traces and investigate suite interaction/load and
readiness at the failure points above; do not relax assertions or raise test timeouts. The Nightly
change modifies no application code or browser specs. Per the verification budget, record this
evidence and leave the next full run to PR CI rather than repeating full suites locally.
