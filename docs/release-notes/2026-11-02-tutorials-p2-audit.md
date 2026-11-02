## Tutorial coach measurements and P2 audit

The tutorial coach shares one before-paint measurement when protected-overlay, chrome and card-size observers report together. Initial placement stays synchronous; camera updates still coalesce to animation frames. Disconnecting the coach cancels queued measurements. This resolves #414 R-e900996b1e without changing lesson behavior or adding controls.

The regression verifies the actual observer subscriptions, counts measurements across overlapping notifications, retains later updates and checks cleanup with the animation clock held. Restoring the original implementation fails it; deliberate duplicate-delivery and extra-frame mutations fail it too.

## Already resolved on the starting master

Audited against d0ac286b3, which includes #414 (988a05432). These items are skipped rather than implemented again:

| Review | Items                                                  | Existing implementation and coverage                                                                                                                                                                                                                    |
| ------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #398   | R-235dce8195, R-061c6d05da                             | Keyed `chapters.ts` descriptors derive seal identity; `chapters.test.ts` checks migration; `tutorials-syllabus.spec.ts` checks backfilled dates in storage across reloads.                                                                              |
| #399   | R-145e7ad350, R-cd20f8f345                             | `progress.test.ts` compares every surviving progress entry after scoped resets; the reset dialog and seal rules use the shared chapter descriptors.                                                                                                     |
| #399   | R-6b44e80f97                                           | Superseded by the owner-selected v7 completion treatment. Existing handoff unit/browser tests require covered workbench controls to remain inert until dismissal. Changing that would contradict the current interaction contract.                      |
| #401   | R-4ef5b06320, R-6f6d6eb5f8, R-9bd23e263b, R-2e6f623628 | Shared protected-control discovery, rendered unavailable-target strip fallback, filtered note-layout mutations and expanded-note/instruction separation already have coach/layout unit and browser regressions.                                         |
| #402   | R-4223a6f7bd, R-bbf6cf482a, R-4b0ed35f5a               | Dock publication is change-only; authored keyboard solutions precede generated routes (including unsupported pointer gestures); cancelled export tests wait for observed work to settle.                                                                |
| #404   | R-c1f14c8b55, R-0b81a726f3                             | Finding checks name the repaired topic; `verifiedBlocks.test.ts` runs a wrongly wired API-gateway diagram and rejects its evidence.                                                                                                                     |
| #405   | R-489b900e79, R-dea7b0773e                             | Parser-failure tests retry the real import bridge successfully. Sticky sandbox privacy has matching confirmation copy and browser coverage.                                                                                                             |
| #406   | R-78e275b69d, R-5b41e55506                             | `src/live/SequenceDialog.test.tsx` covers Mermaid refusal/Retry against the actual lesson check; capacity interpretation uses explicit acknowledgement, keeping its explanation available.                                                              |
| #408   | R-58cb913dc6, R-3ad126c8b6                             | `CoachCard.test.tsx` checks no placement work while completion-hosted and resumption after removal; coach browser tests traverse generated Connect, Reconnect and grow routes.                                                                          |
| #410   | R-6cc56305b9, R-462a006bbb                             | The blueprint calls model `splitEdge` and tests label preservation. Tooltip subscription regression lives in `src/canvas/NodeTooltip.placement.test.tsx`.                                                                                               |
| #412   | R-f1e13bd12e                                           | Diagnostic lesson tests hold the real Testing state until its specific edge readout is inspected.                                                                                                                                                       |
| #413   | R-9ef88cbfff, R-d259fd035b, R-2d660cade9, R-894811ada0 | Pending-peer tests cover cancellation, late-client cleanup and recovery. AI lifecycle belongs to the mounted host behind runner ports. Browser tests use restored Undo/Revert buttons; unavailable-capability tests check consistent handoff numbering. |

## Deferred scope

Retain `docs/backlog/2026-11-01-tutorial-review-deferred.md`: neither outstanding entry is fully resolved by this change. #412 R-efb37af90f (also deferred in #414) requires persisted timeline-note identity through editor/save/import. The model currently has no stable timeline-step identity; another text/time heuristic would misidentify learner notes.

#402 R-fd7225032d (also deferred in #414) requires collaboration's room lifecycle to bind membership observations explicitly to the mounted room editor, independently of the initiating document's cancellation ownership. Its producer retains the initiating source in `src/collab/room/lifecycle.ts`; the tutorial runner cannot repair that attribution safely. This crosses the tutorials-only boundary.

#402 R-8ecc02383f remains deferred as requested: admitted-join completion needs a connected runner across a real room-editor mount, including cancelled/rejected consent and pending navigation. The existing real-room event test exits the tutorial first. The AI half already exercises a connected runner and a refused reply before a successful applied turn.

No new simulation, planning or stencil feature is introduced, so no showcase addition is needed. Output parity must remain unchanged; no goldens are re-recorded.
