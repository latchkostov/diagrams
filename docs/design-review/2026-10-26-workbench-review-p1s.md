## Review #358 correction round

No controls were added. The existing rail, dock, native Speed select, presentation controls and narration sheet retain their keyboard and pointer affordances. AI visibility now controls microphone ownership without discarding draft/reply state. Export capture temporarily removes camera detail and reapplies it after success, failure or cancellation; late surface mounts and nested captures share that suspension.

## Findings and regressions

`tests/e2e/review-358.spec.ts` names each reviewed regression by ID. All 17 browser cases pass with the corrections and fail when the reviewed defects are restored. The mutation run had 17 failures, zero passes, zero flaky cases. Unit mutations also reject unavailable Checks, catch missing export suspension, and prove both hidden-node readiness and retry-until-visible focus policy. Restoring only the old keyboard policy fails its multi-frame focus test.

The two reviewed workflow defects were independently restored: querying the absent collapsed library and opening Properties while the report is modal. Both original workflow tests fail, then their corrected sources are restored. Theme assertions now read document state and the checked preference without selecting a theme; callers explicitly establish the initial preference and retain their toggle assertions.

| Finding      | Correction                                                            | Coverage                                                                                    |
| ------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| R-db805d3041 | Cancel active/pending speech and disable the shortcut for inactive AI | Advanced and on-device dictation, active and pending                                        |
| R-cf27e61cc1 | Retain edge-aware selection fit                                       | Edge-only Shift+2 route/label visibility                                                    |
| R-d4400bbfaa | Resolve complete routing options inside FrameDetail                   | Icon-only routing with dependencies hidden                                                  |
| R-c7d1533b30 | Reconcile roving stops against enabled, visible rail controls         | Stencils → Diagram → Tab re-entry                                                           |
| R-fdc778e36c | Restore Select focus after navigation; handle closed phone overflow   | Navigation focus and disappearing overflow item                                             |
| R-081d6234ae | Keep keyboard focus pending until culling reveals its target          | DOM port plus controller across five hidden frames                                          |
| R-64f737571f | Restore current model routes in cleanup                               | Truncated Focus paths → Present                                                             |
| R-061a263911 | Suspend and neutralize camera detail throughout image capture         | Actual SVG exports in Overview/Focus; failure/late-mount/nested-capture units; image parity |
| R-8ea66b0634 | Validate Checks availability before dock mutation                     | Store notifications plus Checks → close → Live → reopen                                     |
| R-caf692ac78 | Leave editable navigation keys to native controls                     | All four select keys and real speed change                                                  |
| R-6c8bc47a03 | Retain the landed ordinary-presentation transport repair              | Visible and working playback in presentation                                                |
| R-1129cd5c6f | Show the canvas Live toggle during presentation                       | Start and leave Live without exiting Present                                                |
| R-94e0cd3edb | Keep sheet controls mounted and hand disabled navigation to Close     | Later/Earlier focus and note changes                                                        |
| R-0994a05580 | Make expectTheme read-only                                            | Click observation, rendered theme, checked preference, existing theme loops                 |
| R-20b1c4bc7e | Open the fresh unpinned library before querying it                    | Pending translated catalog/search/name preservation                                         |
| R-a006d54348 | Inspect Properties after report close and name-focus handoff          | Done focus, storefront focus, private badge                                                 |

## CI failures and decisions

The pulled repair already contains the card-box and trace-geometry fixes (`b6bce9769`) and removes duplicate forced card measurements (`eba72910d`). Their existing fit, trace and render-count assertions remain strict. The rename/connect workflow now settles camera geometry before measuring handles and explicitly reveals Inventory before its next rename. Performance setup waits for its card boxes and the selection boundary before counting, with per-node diagnostics on failure. Pixel sampling disables transient CSS animations without changing its one-channel tolerance.

Unmounting AI when changing tabs was rejected because it discards unfinished input and feedback. Raising render limits, timeouts, bundle limits or ZIP limits, forcing occluded clicks, and accepting camera-dependent image output were rejected. The first Linux load attempt failed during collection due to a duplicated test import; it is discarded as runtime evidence and corrected before the retained run.

## Title-card cache sampling

The broad affected-spec Linux sweep passed 642 cases with one existing skip. A later twelve-worker stress repeat caught the title-card cache test taking its baseline before a pending Markdown/font invalidation. The app correctly remeasured when that content arrived, between the test's two browser tasks. The test now waits for rendered Markdown and font readiness, then samples a resize burst in one browser task. Its zero-extra-clone assertion and the content, font, appearance and width invalidation assertions remain unchanged.

## Full-suite follow-up

The single complete Linux E2E run completed with 2,714 passed, two failed, zero flaky and one existing skip. The rapid-Tab test reached the correct destination but still expected four journal strings ending in `@frame`; these now precisely expect the readiness-aware `@measured` policy. The self-hosted import test opened Properties before the lazy importer replaced its original diagram; it now waits for the imported storefront before opening Properties. Focus, journal order, privacy, report and sharing assertions are preserved. These two specs receive a focused Linux recheck rather than another complete suite.
