## Workbench regression review for PR 358

Reviewed the shared dock, phone playback, Overview silhouettes, connection gestures, captions, trace framing and recording against the UX principles. The fixes use existing menus and dock disclosures; they add no permanent toolbar row. Inputs and AI remain reachable on phones, tab changes preserve unfinished work, and transient callouts yield space to the diagram.

The clean council-fix revision reproduced 195 failures in Linux: 2,498 passed, 195 failed, zero flaky and one skipped. Counts below assign each failed case one primary cause; some fixes address more than one cause.

| Cause                                      | Cases | Fix type         | Principal files                                                        |
| ------------------------------------------ | ----: | ---------------- | ---------------------------------------------------------------------- |
| Moved controls and progressive disclosure  |    86 | Flow             | `tests/e2e/fixtures.ts`, library, Checks, i18n and inspector specs     |
| Phone controls and badge reveal            |    20 | Product and flow | `ControlBar.tsx`, `TopBar.tsx`, `showcase-examples.spec.ts`            |
| Navigation after dock resizing             |    18 | Product and flow | camera geometry, trace handoff, flow-building and bulk-selection specs |
| Gesture geometry and measurement           |    15 | Product          | node/edge handle CSS, connection placement, settled selection          |
| Focus handoff and redundant renders        |    13 | Product and flow | `CanvasView.tsx`, `Inspector.tsx`, `domPort.ts`, `focusPolicy.ts`      |
| Follow subject and pin navigation          |    11 | Flow             | large-showcase narration pin navigation                                |
| Frame culling and readable navigation      |    10 | Product and flow | `FrameDetail.tsx`, `liveScene.ts`, canvas and navigation specs         |
| Chrome and overlay overlap                 |    10 | Product          | callout placement, narration, Live and inspector CSS                   |
| Presentation, capture and generated viewer |    10 | Product and flow | `LiveSession.tsx`, capture specs, regenerated skill viewer             |
| Theme tokens and moved theme control       |     2 | Flow             | shared View helper and Forge theme assertions                          |
| Total                                      |   195 |                  |                                                                        |

The two failed CI benchmark cases stopped while preparing click targets. Existing numeric gates in that run passed. The corrected setup chooses three distinct exposed nodes before counting begins. Investigation also found redundant settled-selection and Inspector renders; these were fixed with no budget or baseline changes.

Rejected raising budgets, increasing timeouts, disabling culling wholesale, and restoring old toolbar surfaces solely for tests. Suppressing library notifications was rejected because it left import-report metadata stale. Content consumers retain every notification; the picker alone filters content-only saves, as described below.

Regression tests include temporarily reverted unit fixes for absolute search coordinates, transport overlap, palette focus readiness and settled-selection render counts. The existing Live-scene and DOM-visibility regressions were also checked without their fixes. The 14 selected browser regression cases all failed with the product changes temporarily reverted. After restoring the changes, targeted cases pass. Standalone export parity checks 50 goldens with zero changes. The 24 selected-layout and one handle-transform golden changes are explained individually in the release fragment. The full benchmark run passed all 95 gates; the final targeted render/bundle check passed all 40 gates after the export-scoping correction. Full parity checked 3,178 goldens with no remaining differences. Ten final targeted UI cases pass, including all three slow-motion Inspector camera cases. An intermediate bind-mount Linux rerun was discarded after a native build overwrote its shared output directory; final Linux verification uses an immutable archive. A native full unit attempt reported timing failures and stalled after a worker termination timeout; isolated platform, locale, bundle-baseline and sync checks subsequently passed. Full Linux gate validation remains pending.

## Follow contract and autosave renders

The existing `docs/release-notes/2026-10-26-workbench-camera.md` specifies a readable subject and off-frame pins, and the council review already applies that contract to narration resize checks. This resolves the earlier question without a new product decision. The eighteen desktop/phone narration paths retain all card bounds, note clearance, transport clearance and width assertions; they reach distant cards through pins and explicitly resume Follow between visits. They also assert the initial automatic Follow mode and zoom floor. A standalone production diagnostic passed all eighteen pin paths.

A later exact-SHA benchmark found 4.83 commits per typed key at 500 nodes against the unchanged 4.5 limit. Autosave notifications still reach content consumers such as Import report; only the library picker avoids a refresh when its title, count and privacy metadata are unchanged. Explicit opening and cross-tab events still refresh its latest thumbnail and timestamp. The integrated hook/storage regression passes and fails when the fix is temporarily reverted.

The first signed checkpoint also exposed three extra startup chunks in both deployment configurations. Restored Lab history buttons had imported the top-bar history module, extracting its shared dependencies into eager requests. The Lab now uses its existing editor API directly. The unchanged bundle-split suite passes all 26 checks, including the original 19-chunk startup list with collaboration both off and on.
