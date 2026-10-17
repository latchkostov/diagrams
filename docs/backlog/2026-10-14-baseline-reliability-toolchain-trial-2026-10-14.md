## Baseline reliability (toolchain trial, 2026-10-14)

- **P2: quick-add connection naming flake.** `flow-building.spec.ts`'s typing/Tab test sometimes reads
  the new edge without its `SET NX` label. It retried in baseline PR #113 (run 38673071376) and again
  in the modernized run 38678179132. Reproduce and distinguish commit/readiness timing from lost input;
  keep the label assertion and retries visible.
- **P2: HTML viewer initial fit varies.** On unchanged master, the dark HTML parity fixture's viewport
  scale varied from 0.62963 to 0.630798, moving its drawn-geometry and screenshot goldens. Investigate
  font/measurement readiness and fit ordering; do not re-record the goldens to accept a race.
- **P2: import-layout complexity sampling.** `src/interop/infra/layout.test.ts`'s custom fastest-run
  sampler failed at ratio 25.49 against 24 on unchanged master. Convert to the shared interleaved
  `growth()` helper and verify a deliberate quadratic regression, preserving the existing limit.
