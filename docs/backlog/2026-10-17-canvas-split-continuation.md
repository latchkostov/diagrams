## Canvas split continuation

Document identity/autosave and chrome are pushed on `refactor/split-canvasview`, through
`2e719b70a8029a55f081516e86af682f59243a6a`. CanvasView went from 2,641 to 2,337 lines.

Selection is extracted in a local, signed checkpoint but is **not pushed**. Its CanvasView
is 1,835 lines, with box picking, pointer-up settling, pan keys and keyboard navigation in
`src/canvas/selection/`, plus shared node-kind predicates. Its units, build, size, i18n,
formatting, lint, typecheck and all 2,196 output goldens pass. A source audit expands the
extracted hooks and matches all 194 original CanvasInner calls and dependency arrays.

## Verification blocker: Live trace card covers an edge label

The required Linux neighbour run (`--repeat 3 --workers 12`, production E2E bundles,
ports 6720-6724) finished with 608 passed and 1 failed. The unchanged test
`tests/e2e/text-fields.spec.ts:523`, "live keyboard and menu naming select all of
edge-label-ab", times out at line 541: the trace footer in `live-hud` intercepts the
right-click on `edge-label-ab`.

This reproduces identically on a fresh, clean `origin/master` checkout at
`c5b901e9c68a73f046eb9919d0c9fffaee698165`, created inside the worktree's ignored test
output directory. The broad neighbour comparison passed all 609 cases; a focused run
of the unchanged test with 50 repetitions and 12 Linux workers produced 47 passed and
3 failed. All three failures are at line 541, with the same trace-footer interception.
While collecting this evidence, master advanced to
`b13d4ccfc1f98dac891bca99ebb9537a0b7830ed` (PR #151). Updating the clean checkout to that
tip and repeating the same focused 50-case run with 12 workers again produced 47 passed
and 3 failed, all with the same line-541 Live trace-card interception (the card section,
rather than its footer).

Both clean checkouts remained unmodified. No assertion, test, camera rule or timing was
changed, and no further branch push was made after confirming this baseline failure.

Inside the pinned Playwright 1.64.1 noble image, with the production E2E bundle built
with `VITE_E2E=1`, the focused reproduction is:

```sh
E2E_TARGET=build E2E_PORT=6720 E2E_DEV_PORT=6721 \
E2E_PREVIEW_PORT=6722 E2E_INTERNAL_PORT=6723 E2E_LOCKED_PORT=6724 \
pnpm exec playwright test tests/e2e/text-fields.spec.ts --project=chromium \
  --grep 'live keyboard and menu naming select all of edge-label-ab' \
  --repeat-each=50 --workers=12 --retries=0
```

Local evidence is in `tests/.output/canvas-selection-e2e.log`,
`tests/.output/g/selection-DmzF22/`, `tests/.output/canvas-clean-master-proof.log`, and
`tests/.output/canvas-clean-master/tests/.output/g/baseline-edge-7bIWsO/`. The latest-tip
proof is in `tests/.output/canvas-clean-latest-focused.log` and
`tests/.output/canvas-clean-master/tests/.output/g/baseline-latest-edge-O8CHuU/`.

The LiveSession particle hit handler accepts edge-label clicks, including the clicks
inside a double-click. That is a possible cause of the trace appearing while naming;
it was inspected, not changed. Diagnose and fix this separately, preserving the UX
contract that double-click opens the inspector. Do not hide the trace, force the click,
loosen the assertion or add a delay to make this test pass.

## Resume the remaining modules

After the separate Live interaction fix, sync the pending selection checkpoint and
rerun the unchanged neighbours three times with 12 Linux workers: followups4-inspector,
round4-polish, drawing-basics, annotations, viewport, platform, flow-building,
undo-selection, text-fields, zones-boundaries, palette-command and editor. Push selection
only after every repeat passes.

Then extract edit commands/placement and menus, in that order, with a signed commit and
push per concern. Those modules have not been applied. Follow the original boundary
plan in `2026-10-17-canvas-split-boundaries.md`: preserve hook order, effect kinds,
dependencies, rAF/timer behavior and the camera controller's existing events. Keep camera
implementation, Inspector and canvas.css in their owners' branches. Run the same Linux
neighbours after each extraction; leave every output golden unchanged.
