## Scope and decisions

Routing owns its stylesheet, immediately after the Inspector import at the same cascade position.
No controls, application text, DOM, selectors, declarations, camera behaviour or layout change.
The chrome budget and progressive disclosure remain unchanged.

Keeping the frozen 563-rule baseline was rejected because every future CSS rule edit would need
an unrelated baseline update. The final checker run proved all 563 original rules unchanged and
all reordered rules independent before its script, fingerprints and dependent tests were removed.
The remaining structural test checks only the import index and file existence, without pinning
rule contents or a concept-file list.

## Final file map

| File                                 | Lines |
| ------------------------------------ | ----: |
| `src/styles/canvas.css`              |    14 |
| `src/styles/canvas/flow.css`         |   292 |
| `src/styles/canvas/groups.css`       |    98 |
| `src/styles/canvas/nodes.css`        |   253 |
| `src/styles/canvas/edges.css`        |   458 |
| `src/styles/canvas/overlays.css`     |   329 |
| `src/styles/canvas/context-menu.css` |   196 |
| `src/styles/canvas/inspector.css`    |   755 |
| `src/styles/canvas/routing.css`      |   219 |
| `src/styles/canvas/dialog.css`       |   115 |
| `src/styles/canvas/annotations.css`  |   408 |
| `src/styles/canvas/quick-add.css`    |   118 |
| `src/styles/canvas/onboarding.css`   |   282 |
| `src/styles/canvas/palette.css`      |   378 |

## Verification

The existing production stylesheet-swap harness passed all 24 cases: empty canvas, Inspector,
context menu, quick-add, Checks and paused Live, at 1280x800 and 1920x1080 in light and dark.
Each pair had exactly zero differing decoded pixels. The local results and log remain under
`tests/.output/canvas-css-proof/`; no screenshots or temporary harnesses are committed.

Deliberately adding an inline rule or an import of a missing file failed the structural test;
restoring the import-only index passed. No permanent rule fingerprints remain.

After sync, unit tests passed: 674 files, 9,729 tests passed, four skipped and no type errors. Production build
and entry-size checks passed: 107.2 kB gzip against the 123.5 kB budget. Regeneration and i18n checks
passed with the existing translation warnings and no generated-file changes.

Full output parity passed: 2,196 goldens, zero changed, added, missing or stale; all 77 Linux browser
cases passed. No golden was re-recorded. Lint, typecheck and formatting run last before the signed
commit; sync and the delivery report record the final branch state. As requested for this adjustment,
PR CI supplies the full gate.
