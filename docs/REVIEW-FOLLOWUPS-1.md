# Review follow-ups 1 (2026-10-15)

Checked against `origin/master` at `bf806a6660ba08c1f9d0d45e97cb862285395340`.
The four reports were read in place; their worktrees were not modified.

## Examples gallery (#118)

- Accepted the pending-launch cancellation finding. The accessibility, architecture, correctness,
  security and types entries describe the same bug, so they share one fix. Publishing hosts can
  consume a ready request but cannot activate Live. The matching owner activates once; an explicit
  exit cancels the request before returning to editing.
- Accepted both test gaps. A cancelled request is now made consumable by publishing its matching
  canvas, Live host and session. Production browser tests leave a saved but unedited example and
  reopen it, for both completed and deferred Save pickers, then promote the reopened copy.
- Rejected a further Save lifecycle implementation change: current master already releases the
  example destination on unmount. Removing that wiring makes both new browser regressions fail.

## Nested boundaries (#115)

- Accepted root lookup, host coverage, spatial compositing, unrelated-update and bounded-work
  findings. The architecture/types root entries describe one bug. Explicit renderer roots exclude
  descendant ID collisions. The editor, Lab and overlap audit share the contrast hook.
- Disjoint fills are checked separately; actual intersections are subdivided into paint stacks.
  A spatial grid, cached caption results and a geometry/color key avoid unrelated measurement and
  repeated contrast calculations. Spatial queries and subdivision share a 32,768-operation budget;
  exhausted work uses theme ink conservatively. The CSS-color cache is bounded too.
- Accepted missing-parent repair: parent IDs must resolve in the original boundary namespace before
  ID remapping. A new generated ID cannot turn an invalid reference into a valid relationship.
- Accepted both coverage gaps: all caption writes must exist on both passes, and a zone-alone drag
  checks its destination and custom/fallback/custom transitions without an overlapping boundary.

## Showcase examples (#120)

- Accepted the phone overlap. The AI dock reserves playback space while Live is visible. Opening
  viewport-wide Live panels folds the dock, including when the viewport crosses the phone breakpoint.
  Browser tests check the exposed, keyboard-focused footer and the independent folding behavior.

## Autoscaling A1 (#117)

- Accepted engine ownership and preflight complexity findings. The runner sends every reachable
  property action to the engine. One allocation helper classifies, projects and patches configuration
  for preflight and setters; ordered preflight is O(N + A), while batch setters retain atomic final-state
  validation. The model's allocation contribution remains shared with saved-run budget validation.
- Accepted resource/HPA refusal coverage: both replacements exercise real budget limits during step
  and resume, preserve the entire refused operation, then match a clean retry exactly.
- Accepted partial-readiness coverage. Current coalescing behavior is correct; the old test had zero
  startup jitter and only one starting replica. The replacement observes a real partial readiness
  publication before completion, while speech remains unchanged.
- Updated existing controller/oracle fault-injection seams to the shared engine validator. They still
  check refusal recovery and next-step replay; no invariant was weakened.

## Validation and UX

Each fix has a deliberate reversion or fault mutation that must fail its regression. Performance
checks count projections, contributions, spatial work or DOM measurement passes; none asserts a
millisecond budget. Browser checks use production builds and data-testid selectors.

No control was added. The phone changes preserve access to playback and AI controls, fold the dock
for full-width panels and keep focus recovery. Caption fallbacks and parent repair are automatic.
These are fixes to existing features, so no additional public showcase is needed.

Parity compares all 1,761 existing goldens unchanged, including the eight existing browser deferrals.
The offline skill viewer is refreshed at plugin 1.1.24, one patch above origin/master; generated
implementation bytes change, while schemas, public contracts and all semantic goldens stay unchanged.

Final verification: `pnpm test` passes 528 files / 7,169 tests, with four existing skips and no type
errors. Production Chromium passes 176 gallery/picker/boundary/showcase/autoscaling/live/interop
checks plus 23 Live rendering/labels/recording checks, on explicit ports 6310–6319. Build, size
(105.7 kB gzip entry versus 123.5 kB budget), i18n and skill freshness checks pass. I18n retains
existing translation warnings and reports zero errors. Full parity passes both Node and Docker/Linux
browser tiers, with all 1,761 goldens unchanged and eight existing browser deferrals.

The first full unit run failed 206 cases because five controller tests and 200 seeded-oracle cases
still injected failures through the replaced validator, and generated skill implementation was stale.
The updated fault-injection seam and regenerated implementation resolve all of them; the full rerun
passes. Focused browser development also caught and corrected a resolved-CSS-variable assertion and
the Lab's transparent measurement background. Deliberate negative controls then fail for all targeted
regressions, including five million old preflight node visits versus seven thousand current contribution
calculations. No golden was re-recorded to accommodate a failure.
