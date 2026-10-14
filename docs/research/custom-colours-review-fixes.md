# PR #102: custom colour review fixes

Review: `.reviews/20261014-173908/REPORT.md`. All 7 P1 and 12 P2 reports are real;
none was rejected. Several reviewers independently reported the same defects.
Heiner Morales's commits, palette layout and design intent are preserved.

| Finding (report order)                            | Disposition and coverage                                                                                                                                                                                                          |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1 architecture: separate dismissal from mutation | Accepted. Close/Esc/outside only dismiss; native serialized values remain distinct from the preview. All three mixed/background browser regressions check colour values and disabled Undo.                                        |
| P1 architecture: lossless shared contract         | Accepted. React-free model colours supply normalization, strict stored validation and schema pattern; alpha tests cover 4/8-digit forms.                                                                                          |
| P1 correctness: preserve untouched colours        | Accepted; same dismissal fix and mixed/unset tests.                                                                                                                                                                               |
| P1 tests: untouched dismissal coverage            | Accepted; new production picker spec covers every exit path.                                                                                                                                                                      |
| P1 tests: generated artifacts                     | Accepted. Regenerate schemas and skill bundle; refresh released viewer and version. Existing consistency tests guard generated content.                                                                                           |
| P1 tests: complete translations                   | Accepted. White and new picker labels translated/stamped in all 37 locales; catalog presence/stamp regressions and i18n check.                                                                                                    |
| P1 types: untouched document                      | Accepted; same dismissal fix, preserving absent/preset/mixed/alpha values.                                                                                                                                                        |
| P2 accessibility: focus containment/restoration   | Accepted. Extract shared dialog lifecycle, inert background, Tab wrap and opener restoration; prevent outside mousedown's default focus movement. Browser tests check keyboard and mouse exits.                                   |
| P2 accessibility: readable custom ink             | Accepted. Use theme foreground independent of arbitrary tint, against the existing restrained fills. Browser contrast checks cover extreme white/black/transparent captions in both themes.                                       |
| P2 accessibility: hash-prefixed paste             | Accepted. Input normalizes one optional hash and accepts all eight colour digits plus hash; production bulk hex-entry test.                                                                                                       |
| P2 architecture: shared dialog lifecycle          | Accepted; same hook handles dialog and anchored picker, local Enter/Esc order and context-menu suppression.                                                                                                                       |
| P2 correctness: preserve alpha                    | Accepted; shared normalization preserves every alpha digit, including full opacity.                                                                                                                                               |
| P2 correctness: offline checker                   | Accepted. Checker imports the app's colour validator, accepts canvas colour and checks annotations consistently. Skill validation and HTML export tests cover custom alpha.                                                       |
| P2 performance: redundant commits                 | Accepted. Emit distinct normalized changes only; blur/close never emit. Lab mutation-count regression proves one write remains one after blur/close/reopen.                                                                       |
| P2 security: invalid colour objects               | Accepted. Never coerce objects in native warning text; cap string previews at 80 characters. Native, viewer payload and host load tests exercise objects and alpha.                                                               |
| P2 security: dismissal removes transparency       | Accepted; shared normalization and dismissal fixes preserve four/eight-digit alpha.                                                                                                                                               |
| P2 tests: normalization coverage                  | Accepted; zero/partial/full alpha parameterized cases.                                                                                                                                                                            |
| P2 types: supported alpha                         | Accepted; same lossless contract.                                                                                                                                                                                                 |
| P2 types: bulk undo tag                           | Accepted. Allocate a tag at picker open and reuse it for single/bulk/meta updates; the bulk test chooses a swatch, enters an intermediate short hex and a final alpha hex, then restores the original mixed values with one Undo. |

## Deliberate regression evidence

- Temporarily restoring contributor normalization/native/draw.io code caused 18 focused failures,
  including lossless alpha, invalid object robustness, bounded diagnostics and invalid metadata rejection.
- Temporarily restoring offline checker guards caused 11 failures for custom hex and canvas colour.
- Restoring the original German catalog caused the new catalog test to fail on missing `chrome.white`.
- Temporarily restoring contributor picker/inspector/custom-ink code exercises the new browser regressions;
  8 cases failed on the contributor code; the fixed files were restored before final verification.

- Independently restoring the original custom-ink CSS failed both theme contrast tests. Restoring only
  the original inspector failed the bulk one-Undo assertion after the final alpha hex edit.

## Decisions

Keep the contributor's curated presets and full grid. No new toolbar controls or palette redesign.
Preserve opaque alpha digits too: stripping them is unnecessary and a lossless contract is easier to
share. Reset restores absent/default semantics instead of turning a preset into a custom hex.
Background tint uses React style property updates and the existing shared CanvasView, so strict CSP
continues to apply in the editor, presentation, exports and embeds.

## Final verification

- Production Chromium: 203 selected-suite tests passed, plus 4 targeted picker axe/Arabic/pseudo-locale
  tests (207 total). Covers annotations, inspector, draw.io/interop, HTML exports, released skill HTML,
  host embeds, i18n, a11y and CSP. Playwright stopped its servers; ports 6170–6179 are clear.
- Full unit suite: 6,063 passed, 4 skipped, no type errors on the initial run and on final
  `CI=true pnpm test --maxWorkers=2`. Existing generated-schema, skill and startup-chunk consistency
  tests passed. No tests or assertions were disabled or weakened.
- Later local unit runs failed: 9 cases while overlapping e2e, 5 on a default-worker standalone run,
  and 12 with four workers. These included the five-second local backstop, a growth-ratio assertion
  and worker-state assertions following timeout. The final CI-profile run passed without code changes
  to those tests; retain these earlier failures rather than hiding them as retries.
- `pnpm build`, `pnpm size`, `pnpm skill:check` and `pnpm i18n check` passed. Entry gzip: 103.9 kB
  versus the 123.5 kB budget. Translation errors/stale messages: zero; 72 previously missing messages
  remain per non-English catalog, outside this change's labels. Released plugin version: 1.1.16,
  exactly one patch above master 1.1.15.
- The final designer-agent source/screenshot review approved the scoped light-theme layout at
  1440×900. Dark/RTL/short-viewport checks are automated; no whole-app screen-reader audit is claimed.
  A suggested stacked bulk-swatch label was deferred as a cosmetic refinement: the existing compact
  row fits, and changing the contributor's layout is unnecessary for this fix.
