## Keep placement in charge of the canvas

Quick-add and newly placed content discard earlier deferred pane adjustments. Naming a new item
keeps its own reveal in charge while the Inspector opens, so an older refit cannot change its zoom
or move a pointer-placed item. Cancelling quick-add also leaves no pane adjustment to replay.
Context menus retain the deferred adjustment on dismissal, including interrupted retries and a later
manual camera command.

Regression checks cover quick-add dismissal and picks, pointer text placement, a shape without a
naming editor and the four existing context-menu cases. Coordinate checks wait for the pane they
measure.

## Verification

- The unfixed Linux drawing/annotation specs ran three times with two workers. The dropped-connection
  case failed all three; the original pointer-text case passed all three. Five added fake-clock
  regressions failed with the fix temporarily removed, each detecting an unwanted fit.
- All 28 Inspector tests pass with the fix, including the six added placement checks and all four
  context-menu regressions. The final repeated five-spec run uses the same two-worker Linux gate.
- Targeted camera ownership, placement, sheet width, fragment and startup-bundle unit tests pass.
  Production build and entry budget pass (107.0 kB gzip against 123.5 kB).
- `pnpm regen` refreshed the skill viewer; i18n validation reports zero errors. `pnpm parity` checked
  all 2,196 goldens: zero changed, added, missing or stale. No golden was re-recorded.
