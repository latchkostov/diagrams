## Scope and baseline

Audit the queued candidates on master a99037759, using current test declarations rather than the
historical line numbers. The loaded cohort runs the unchanged candidate tests with production E2E
builds in the pinned Playwright Linux image. Four browser workers share two CPUs; retries remain
zero. It also covers adjacent variants of the reported cases.

```text
pnpm gate quick tests/e2e/checks-ui.spec.ts:380 tests/e2e/routing.spec.ts:240 tests/e2e/fit-settled.spec.ts:555 tests/e2e/bundle-trim.spec.ts:111 tests/e2e/hover-cards.spec.ts:736 tests/e2e/hover-cards.spec.ts:783 tests/e2e/latency.spec.ts:384 --linux --only e2e --repeat-each 30 --workers 4 --cpus 2 --ports 6740 --max-wait 1
```

Reports: `tests/.output/g/rLUFTlk`. The additional camera-regression test and documentation edits are
not among the selected candidates; their setup and application source remain master-identical.

## Loaded results

All 420 executions pass: zero failed, flaky, skipped or reporter errors. Each row below has thirty
executions per named variant. These are current-source observations, not new before/after
improvements; no natural failure reproduced and no speculative application fix is added.

| Candidate                      | Failures / executions | Disposition                                                               |
| ------------------------------ | --------------------- | ------------------------------------------------------------------------- |
| Checks typing                  | 0/30                  | Earlier readiness fix retained                                            |
| Traffic mix form reopened      | 0/30                  | Not reproduced; retain candidate pending new evidence                     |
| Auto-layout then Fit view      | 0/30                  | Earlier publication fix retained; three other fit variants also 0/30 each |
| Highlighted menu navigation    | 0/30                  | Earlier search wait retained; later-edit variant also 0/30                |
| Focused edge deletion and Undo | 0/30                  | Earlier camera/stroke setup retained; node variant also 0/30              |
| Pinned edge deletion and Undo  | 0/30                  | Earlier camera/stroke setup retained; node variant also 0/30              |
| Latency presentation scrolling | 0/30                  | No recurrence after #418; embed variant also 0/30                         |

```text
SUMMARY: a99037759ae740844f9417d218382f96e5296e6f | unit="not run" parity="not run" e2e={"passed":420,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

## Earlier fixes verified in current source

- Checks typing waits for the imported fixture's exact 101 warnings in `checks-typing.ts`, rather
  than accepting the previous document's count. Performance traces no longer continuously capture
  screenshots. The earlier causal evidence remains in `2026-10-29-flake-fixes.md`.
- Fit readiness includes chip publication as well as measurement/fit completion. Keep the earlier
  held-measurement and chip-publication guards and their unchanged drawing assertions.
- Both searchable-menu variants wait for an active Quick-add result before ArrowDown, including
  after query edits. The ledger's missing-highlight failure predates those waits.
- Both edge-readout deletion cases wait for camera idle before sampling the stroke, pin through
  the named header and await the pinned state. Undo retains its restored-target/unpinned assertions.
- #418 puts latency's camera/viewport wait after node focus and opts in only where needed. The
  ordinary-card regression still permits unrelated camera and pane work to remain pending.
- #397 R-623c806dc6 is already implemented in `stencil-icon-loading.spec.ts`: both production and
  dev count SVG image requests, ignore module imports and retain positive and bounded counts.
  Skip reimplementation. The separate extreme-load artwork-readiness backlog remains open.

## Camera test-probe correction — #418 R-d02410ff09

The controlled latency regression's old probe acknowledged every canvas lookup. The viewport/pane
helper performs one too, so removing only camera settlement could still release the held camera.
The probe now acknowledges only a positive `data-camera-state="idle"` matcher request, forwarding
the real Playwright assertion unchanged. A new browser guard rejects viewport, pending-state and
negated-idle assertions as acknowledgements.

Restoring the old generic-lookup notification makes the new guard fail at `expected false,
received true` (1/1). Restoring the corrected probe passes all five cases on production Chromium.
Removing only `waitForCameraIdle` from `openLiveNodeDetails` while keeping viewport settlement
makes all three movement regressions fail at `expected camera, received pinned` (3/3). Restore the
wait afterward; there is no application/helper behavior change in the final diff. The negative
controls are separate from natural flake rates.

Both complete latency/readiness specs then pass twice in Linux: 40/40 executions, four workers
sharing four CPUs, zero failures/flakes/skips. This includes all five readiness cases twice after
restoring the wait. Reports: `tests/.output/g/roZ1KLu`.

```text
pnpm gate quick tests/e2e/latency-readiness.spec.ts tests/e2e/latency.spec.ts --linux --only e2e --repeat 2 --workers 4 --cpus 4 --ports 6740 --max-wait 1
SUMMARY: a99037759ae740844f9417d218382f96e5296e6f | unit="not run" parity="not run" e2e={"passed":40,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

## Output and focused unit checks

- `pnpm parity`: 3,178 goldens, zero changed, added, missing or stale. No golden re-recorded.
- Production build and `pnpm size`: pass; budgets and reserves unchanged.
- Complete startup/reserve heavy file: 32/32 passed.
- Documentation fragment units: 5/5 passed on recheck. The initial repository-wide encoding scan
  times out at its existing five-second backstop while parity's node tier is active (4 other tests
  pass). With that phase complete, the unchanged targeted file passes in 350 ms. No deadline changes.

## Cross-module items remain open

Stable timeline-note identity (#412 R-efb37af90f) and room-editor observation binding
(#402 R-fd7225032d) still require changes beyond this test-only batch. See the
[design note](../design-review/2026-11-02-flakes-cross-module-p2.md) and the existing
`2026-11-01-tutorial-review-deferred.md` entry for the ownership, compatibility and connected-runner
requirements. No heuristic identity repair or current-canvas-at-leave shortcut is introduced.
