# Example gallery review dispositions (2026-10-15)

PR #118 was rebased onto `origin/master` after #116 merged, without conflicts. The review report
contained ten P2 findings, representing eight distinct issues. All were verified; none was a false
positive. Duplicate reports share fixes and regression coverage.

| Report finding                                          | Disposition and evidence                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accessibility: copy notice obscures stencil search      | Fixed. The status lives in the canvas notification stack and opts into action-toast avoidance. Production e2e checks its bounds against expanded search and collapse controls.                                                                                                                                                           |
| Accessibility: Run it accessible name                   | Fixed with `aria-labelledby` referencing the translated visible action and example title. English and Arabic e2e assert the full accessible name. No message or catalog changes are needed.                                                                                                                                              |
| Architecture and correctness: preserve Save destination | Duplicate findings, both valid. Promotion transfers device handles and provider destinations before rotating the source identity. In-flight save completions follow the original session's promotion mapping; deleted copies reject them. Unit tests cover completed device/cloud saves and late completions across another promotion.   |
| Architecture and correctness: legacy conversations      | Duplicate findings, both valid. Legacy turns and Revert snapshots migrate with retained autosaves under a durable identity. Required migration writes roll back on failure; legacy keys remain readable for retry. Unit tests cover autosave and conversation-only sessions, reload, promotion, pristine reopening and failed migration. |
| Correctness: unreachable shared slot                    | Fixed. Current and shared work are pinned within the eight direct rows; library overflow retains all other saved work. Unit and production e2e tests cover an inactive shared slot with nine saved diagrams.                                                                                                                             |
| Performance: repeated autosave serialization            | Fixed. The existing JSON becomes the saved baseline; only a promotion that changes the document serializes again. A production e2e counts native diagram serializations during an ordinary flush.                                                                                                                                        |
| Tests: hidden saved diagrams                            | Fixed in the navigation helper: hidden owned slugs open through picker-library and library-open. Production e2e seeds nine diagrams and opens the oldest, checking its title and slug. Product library overflow already existed; no additional control was needed.                                                                       |
| Tests: Run it on the mounted example                    | Covered from editing and paused Live, asserting the selected simulation, playing state, reset clock and subsequent advancement with a fake clock. The existing same-example implementation was correct.                                                                                                                                  |

## Deliberate regressions

Temporarily restoring the pre-fix storage, picker, notice, accessible-name, autosave and navigation
helper implementations caused seven unit cases and all seven targeted browser cases to fail. The
same-example browser control additionally removed `paletteHost.runSimulation(simulation)` and failed
to start Live. Restoring the implementation passed all 18 gallery browser tests. The first positive
run had one test-authoring error: Kafka's first simulation is `black-friday`; correcting that expected
value cleared the failure.

No goldens were re-recorded to clear failures. These fixes add no simulation, planning or stencil
feature, so they need no additional showcase diagram. The designer-agent source review is recorded
in [DESIGN-REVIEW.md](../DESIGN-REVIEW.md).

Two additional data-safety controls also failed before their fixes: migrating a legacy cloud Save
binding with the identity, and publishing the fresh example identity to another tab after promotion
(so its old canvas cannot autosave into the reopened source). Both pass after the fixes.

## Validation

- Full unit suite: 6,398 passed, four skipped, no type errors. `pnpm test` used a local configuration
  adapter that reuses the parity harness's public-example isolation; the test selection and application
  configuration otherwise remain unchanged.
- Picker-dependent production Chromium sweep: 248 passed, no retries, on ports 6250–6254, with
  `E2E_TARGET=build` and the e2e build's test hooks. Playwright stopped its servers on completion.
  An initial Windows path argument selected no tests; normalized paths ran the complete selection.
- `pnpm parity`: 797 Node tests and 44 Linux-browser tests passed; 1,425 goldens, zero changed,
  added, missing or stale. No output golden changed in these review fixes.
- `pnpm build` and `pnpm size` passed: entry gzip 104.8 kB against the 123.5 kB budget.
  `pnpm i18n check` reported zero errors, with existing missing translations and glossary warnings.
- `pnpm skill:release` refreshed the viewer; `pnpm skill:check` confirms it matches a fresh build.
  The marketplace version is 1.1.19, exactly one patch above master at the rebase.
- The final gate runs lint, typecheck and format check after the final edit, immediately before the
  signed commit. The first lint invocation also scanned temporary regression-control backups outside
  their source-specific rule configuration; those scratch artifacts were renamed out of the JavaScript
  and TypeScript file extensions before rerunning the final gate. No application lint errors or rule
  suppressions were involved.

## Final review (round 3)

The final report's three P1 and five P2 findings are all valid. They describe five issues; the
privacy and cross-tab reports overlap and share fixes rather than independent implementations.

| Findings                                                                           | Disposition and regression evidence                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Correctness P1, security P1, architecture P2: pending-save privacy after promotion | Fixed with `resolveDocumentSession`, used for both privacy checks and Save binding. Promotion publishes its ownership mapping before notifying subscribers, and cloud completion rechecks cancellation. Production tests hold provider loading and bound uploads, then promote and mark Private both explicitly and by default. No upload, destination update, public URL or outside request is allowed. |
| Architecture P1, security P2: other tabs' mounted sessions                         | Fixed with independent mounted identities and session-bound Save destinations. Future opens get a new identity and retained conversation snapshots; existing sessions keep their own identity. Two-tab unit and production tests retain pending edits, the mounted canvas and Undo/Redo, then promote each snapshot into a separate copy.                                                                |
| Accessibility P2: focus after gallery selection                                    | Fixed with a request for the matching destination canvas, applied after dialog cleanup. Delayed Open and Run it tests assert canvas focus; existing dismissal tests retain opener focus.                                                                                                                                                                                                                 |
| Performance P2: storage-failure retry storms                                       | Fixed with an immediate first attempt, debounced retries and one storage warning. A fake-clock production test counts attempts across eight changes, verifies the original notification stays mounted and recovers the latest edit after storage is restored.                                                                                                                                            |
| Tests P2: storage failure after document creation                                  | Fixed with transactional document, library-entry, source-identity and autosave writes. Unit cases fail entry and source publication after the document write, assert rollback and no orphan, reload the module, reject the old autosave and retry successfully.                                                                                                                                          |

Temporarily removing the fixes failed all eight targeted browser cases and the corresponding session
and publication unit cases. Removing only notification deduplication separately failed the retained-toast
assertion. Removing session-bound destinations and the blocked-storage identity fallback separately
failed their unit regressions. All controls were restored before final validation.

No finding was rejected. Forcing an already mounted tab to adopt the newly published source identity
was rejected because it discards pending edits and Undo history. Ignoring failed publication was rejected
because it leaves a partially promoted copy. An extra Retry control was unnecessary: the existing
storage guidance, debounced edits and lifecycle flushes cover recovery without more chrome.

The branch was rebased onto the toolchain update in master; both release-note entries were retained
and the rebased commits were signed. No new showcase is required for these persistence and focus fixes.
No output golden is intentionally changed or re-recorded in this round. The refreshed agent viewer's
plugin version is 1.1.20, one patch above master.

### Final-round validation

- Rebased toolchain: Node 24.22.0, pnpm 12.11.2. The final full unit run passed 6,414 tests,
  with four skipped and no type errors. The first rebased run hit the same existing five-second
  import-test timeout recorded in the review report; its isolated run and the final full run passed
  without changing a timeout, budget or application code.
- Production browsers: 391 Chromium tests and five subpath tests passed, without retries, using
  explicit ports 6250–6254. The selection includes privacy-audit, private-diagrams, share-chooser
  and every picker-dependent spec; existing dev-only source-import exclusions remain in effect.
  All servers stopped, with no listeners left on ports 6250–6259.
- Parity: 797 Node tests and all 44 pinned Linux-browser tests passed; all 1,425 goldens match,
  with none changed, added, missing or stale. An earlier pre-rebase run differed only in the
  AWS serverless layout golden's viewport; the full rebased run passed without re-recording it.
- Build and size passed: entry gzip 105.1 kB, within the 123.5 kB budget. The full unit run includes
  the startup-chunk regression checks. i18n reported zero errors, with existing missing translations
  and glossary warnings. The refreshed skill viewer matches a fresh build.
- The first targeted positive run needed two fixture corrections: Playwright's clock applies to
  the whole context, and a paused clock must resume before a lazy canvas reload. The corrected
  tests passed before the deliberate reversions and in both full production sweeps.
- Lint, typecheck and format check are the final gates after these edits, immediately before the
  signed commit. Temporary tooling and the public-example test adapter live in the existing
  ignored test-output directory.
