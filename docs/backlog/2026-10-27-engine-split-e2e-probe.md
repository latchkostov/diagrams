## Unreproduced full-gate browser failures during the engine split

Owner: latchkostov. Investigate with the PR CI browser reports before merging the resource/broker
split. The local full gate is red; the targeted probes below do not establish pre-existing failures.

The one full Linux gate on implementation commit `f8d33437c6b71e5eeb6c3f09d21c411fcec422fd`
used 11 workers and 11 CPUs. Static checks, all unit/heavy tests, builds, size checks and parity passed.
Its exact summary is:

```text
SUMMARY: f8d33437c6b71e5eeb6c3f09d21c411fcec422fd | unit={"passed":14007,"failed":0,"skipped":13} parity={"goldens":3178,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":2715,"failed":7,"flaky":0,"skipped":1} gate_failures=1
```

The seven Chromium failures were:

- `latency.spec.ts:31`: context/trace teardown timed out after ArrowDown navigation.
- `lazy-recording.spec.ts:172`: clicking the example button timed out before entering Live.
- `tutorials.spec.ts:1743`: Restart setup expected slow motion; the play control stayed paused/disabled.
- `viewer-bundle.spec.ts:31`: the bundle and Interactive HTML variants found the worker hidden before
  entering Live (two cases).
- `viewer-bundle.spec.ts:205`: the saved-simulation Forge CSP variant found its initial node hidden.
- `viewer-bundle.spec.ts:322`: the Forge CSP keyboard variant found its initial node hidden.

## Clean-master and implementation probes

A clean detached checkout of `origin/master`, `ed765d464369863a5d37a903127720d534ee835c`, ran only
the four affected spec files, twice each. Latency used one worker/CPU; the other three files used six
workers/CPUs after a ten-worker request exited 75 because capacity was busy. Each run used Linux
production builds and zero retries. Both summaries are green:

```text
SUMMARY: ed765d464369863a5d37a903127720d534ee835c | unit="not run" parity="not run" e2e={"passed":24,"failed":0,"flaky":0,"skipped":0} gate_failures=0
SUMMARY: ed765d464369863a5d37a903127720d534ee835c | unit="not run" parity="not run" e2e={"passed":378,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

The implementation then ran just the failing lines listed above, using six workers/CPUs, Linux
production builds and zero retries. Parameterized lines select nine cases; all passed:

```text
SUMMARY: f8d33437c6b71e5eeb6c3f09d21c411fcec422fd | unit="not run" parity="not run" e2e={"passed":9,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

These probes did not reproduce the full-gate failures on either revision. Different concurrency
prevents attributing them to either the engine split or an existing race. No browser assertion,
timeout or UI behavior was changed. Following the task's verification budget, preserve the red result
and continue with PR CI instead of repeating a full local suite. Resolve any reproducible regression
before merging; do not weaken camera or playback assertions.
