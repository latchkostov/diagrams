## Scope and decisions

A pure stylesheet extraction. No controls, layout, timing, component imports, DOM, ARIA, class names,
test ids, camera events, simulation code or application text change. The chrome budget and progressive
disclosure remain unchanged.

The original history-based fragment plan was rejected: one concept owns its base rules and later
overrides. No numbered, late or miscellaneous fragments were introduced. Cleanup of unused rules,
selector renaming, stylesheet minification changes and feature work were excluded.

The Inspector remains the largest concept because the requested map keeps its fields, disclosures,
annotation controls, autoscaling controls and routing fields together.

## File map

| File                                                         | Lines |
| ------------------------------------------------------------ | ----: |
| [flow.css](../../src/styles/canvas/flow.css)                 |   292 |
| [nodes.css](../../src/styles/canvas/nodes.css)               |   253 |
| [groups.css](../../src/styles/canvas/groups.css)             |    98 |
| [edges.css](../../src/styles/canvas/edges.css)               |   458 |
| [palette.css](../../src/styles/canvas/palette.css)           |   378 |
| [overlays.css](../../src/styles/canvas/overlays.css)         |   329 |
| [context-menu.css](../../src/styles/canvas/context-menu.css) |   196 |
| [inspector.css](../../src/styles/canvas/inspector.css)       |   975 |
| [dialog.css](../../src/styles/canvas/dialog.css)             |   115 |
| [onboarding.css](../../src/styles/canvas/onboarding.css)     |   282 |
| [annotations.css](../../src/styles/canvas/annotations.css)   |   408 |
| [quick-add.css](../../src/styles/canvas/quick-add.css)       |   118 |

The original canvas.css had 3,906 lines. The index now has 13 lines; its concept files total
3902 lines. Comments explain the shared bridge, annotation-outline and stencil-preview ordering.
The shared RTL menu/rail selector list stays intact in palette.css. Onboarding's matching RTL rule
is adjacent across the import boundary, preserving the minifier's merged declaration and startup size.

## Cascade proof

node scripts/check-canvas-css.mjs expands the imports and verifies all 563 original rule fingerprints.
Strings, declarations, duplicate rules, keyframes and media/container blocks retain their original
tokens and contexts. Possible overlapping properties include shorthand/logical families. Reordered
pairs are checked for cascade priority, equal-or-higher crossed specificity, pseudo-elements, element types and authored
component/class relationships. Unknown matching relationships remain order-sensitive.

The audit models this app and React Flow v12's fixed wrappers; it is not a general CSS optimizer.
Literal/template branches and forwarded classes are conservatively unioned; component call paths
remain distinct. The imperatively created image-export title is also represented. Four unused legacy
selectors have no current producer; their rules remain, and a guard rejects a new producer without
an audit. Follow-up: [legacy selectors](../backlog/2026-10-17-canvas-css-legacy-selectors.md).

Vitest rejects changed declarations, changed media conditions, reordered equal-specificity overrides,
a reversed shared-node preview override and a settings-card bridge moved across the more specific
pip bridge. Deliberately disabling the order guard and then weakening the specificity guard each failed the corresponding regression; restoring them passed.
The checker also runs with an invalid GIT_DIR, so Linux gate archives do not need Git metadata.

## Visual verification

All six requested surfaces were captured at 1280x800 and 1920x1080, in light and dark: empty canvas,
a public example with the Inspector open, context menu, quick-add, Checks and paused Live.
Only public examples were used.

The separate-load Playwright comparison passed all 24 cases at zero threshold and zero differing
pixels according to its comparator. A stricter decode found two antialiased pixels (maximum one
channel level, at x897-898/y280) in the first dark 1280 Inspector capture. A paired check then swapped
the original and final built stylesheets on the same settled page: all 24 pairs had exactly zero
different decoded pixels. No baselines or parity goldens were re-recorded.

Before/after PNGs, per-pair pixel counts, build metadata and logs are retained locally under
tests/.output/canvas-css-proof/. The paired-before/ and paired-after/ directories are the strict proof.

## Build and validation

- CI=1 pnpm test --maxWorkers=4: 670 files passed; 9,655 tests passed, four skipped; no type errors. This includes the unchanged production bundle-split contract.
- pnpm build and pnpm size passed. Entry JavaScript stays at 107.1 kB gzip against 123.5 kB. The consistent asset comparison shows only +123 raw / +48 default-gzip bytes in the entry, within compression/dependency-map noise.
- Startup CSS stays at 125,754 bytes; level-9 gzip drops from 23,677 to 23,661 bytes. Every other production CSS asset is byte-identical, including Live (7,349 bytes) and Checks (5,329 bytes).
- pnpm parity: 2,196 goldens, zero changed/added/missing/stale; all 77 Linux browser cases passed. No golden was updated.
- pnpm regen refreshed only the committed viewer template. i18n reports zero errors, with the existing translation/glossary warnings. No UI text changed.
- Lint, typecheck and formatting run last before each signed extraction commit. Lint retains the existing RoutingFields.tsx Fast Refresh warning, with no errors.

The shared gate front-end was cancelled while queued, before it started tests. The Linux interaction sweep uses the same targeted quick E2E steps directly in the pinned container, with separate dependencies/reports: annotations, drawing-basics, round4-polish, viewport, platform, inspector, inspector-resize, followups4-inspector, flow-building, checks-ui, firstrun, present, palette, palette-command and CSP. It runs after the final commit and sync; its JSON/SUMMARY and the delivery report hold the result. No full-gate verification stamp is claimed.

Full local gates and benchmarks were not run, following this task's shared-machine override; full
coverage is left to PR CI. The targeted Linux run uses four workers and five repetitions.
