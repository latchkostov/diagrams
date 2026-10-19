## Unreproduced failures in the full Linux gate

During the platform viewer review fixes, the full gate ran once with its automatic 12 workers/CPUs.
All static, unit, build, size and parity stages passed. Five Chromium cases failed:

- `a11y.spec.ts`: light and dark Stencils scans exceeded the test timeout.
- `slowmo.spec.ts`: �an open Inputs panel and capacity Apply fix wait until slow motion ends� saw
  paused playback instead of slow motion.
- `live-record-capture.spec.ts`: both worker-path cases (particles/marching edges and slow-motion
  captions) did not reach visible Live controls.

```text
SUMMARY: 2ad4217c832e1cb192a5f6a55777ad5f3a21f407 | unit={"passed":11432,"failed":0,"skipped":4} parity={"goldens":2530,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":1737,"failed":5,"flaky":0,"skipped":0} gate_failures=1
```

## Bounded clean-master comparison

A clean, detached checkout of `origin/master` at `aef58d3655a0a45396290cfa854a14f3d2c55b6e`
was created inside this worktree's ignored test output. Only the three failing spec files ran,
with `pnpm gate quick <three specs> --only e2e --linux --repeat 2 --workers 12 --cpus 12`.
Both repetitions passed all 55 cases. These failures are **not confirmed pre-existing** by this
focused comparison; the full run's mixed workload may matter. No full master suite was run.

```text
SUMMARY: aef58d3655a0a45396290cfa854a14f3d2c55b6e | unit="not run" parity="not run" e2e={"passed":110,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

## Follow-up

Reproduce the five cases under the full mixed workload in CI, then identify the actual readiness,
resource or playback boundary. Preserve their assertions and existing timeout limits. No timeout
increase, assertion relaxation or unrelated editor change was made in the viewer review fixes.
The affected viewer/Interactive HTML tests passed all 21 cases, all eight bundle regressions passed
again after the final test edit, and deliberate removal of the fixes made the regressions fail.
The requested five-repeat Linux neighbour run was attempted but exited 75 while the shared budget
was busy. Continue with PR CI under the bounded verification instruction; the full local gate is red.
