## Camera-readiness regression coverage

The Live-details regression driver distinguishes the camera's idle assertion from a generic canvas
lookup. Viewport or pane checks can no longer accidentally release a held camera in the test. A
browser regression verifies the distinction and fails when the old lookup behavior is restored.
Application behavior and file formats are unchanged.

## Audit scope

The requested flake candidates are rechecked under Linux load against master a99037759. Historical
fixes and current measurements are recorded separately in the
[flake audit](../backlog/2026-11-02-flake-candidate-audit.md). All 420 executions pass, with every
candidate at 0/30 failures; no new natural flake-rate improvement is claimed. #397 R-623c806dc6 is
already resolved: the artwork spec counts actual SVG image requests in both production and dev,
excluding module imports, with positive and upper-bound assertions.

Stable timeline-note identity and mounted-room observation ownership remain deferred. The
[design review](../design-review/2026-11-02-flakes-cross-module-p2.md) specifies the missing contracts
and regression scenarios; neither receives a heuristic workaround.

## Output parity

`pnpm parity` checks all 3,178 goldens: zero changed, added, missing or stale. No golden is
re-recorded. This test-only change preserves application output, public schemas, bundle budgets
and reserves.
