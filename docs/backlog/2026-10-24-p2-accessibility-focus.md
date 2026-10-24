## P2 triage: Accessibility and focus (2026-10-24)

Checked against `origin/master` at `7b6e905130a9`. DONE 16 / STALE 0 / OPEN 9 (deduplicated actionable findings).

Source: the local `queued-p2-fu10.archive.md`, preserved byte-for-byte on 2026-10-24. OPEN entries retain queue review labels; closed entries name the fixing PR. Locations are current-master entry points, not the old review line numbers. DONE means code and/or the specifically requested regression exists with merged-PR evidence; OPEN includes unproven historical failures. A later green run alone does not close a failure.

Each numbered batch below is an independent PR candidate of at most ten items, ordered by user impact. Keep regression assertions and current bundle limits; verify each eventual regression by temporarily reverting its fix. Refactors must preserve output parity; intentional behavior changes need reviewed golden diffs. Owner decisions remain in [the separate decision list](2026-10-24-owner-decisions.md).

## Batch 1: Accessibility and focus (9 OPEN)

1. **AF-01 — OPEN: Announce blocking drill validation errors.** `src/live/SimPanel.tsx:433`. Queue: #173.
   The invalid-draft message is a plain paragraph, so keyboard and screen-reader users can miss why Save is disabled. Add an associated live error region and test the announcement after an invalid edit.

2. **AF-02 — OPEN: Explain validation with field names and limits.** `src/live/validate.ts:15`. Queue: #173.
   Some validation still exposes generic errors. Map each invalid field to its name and accepted range, link the message to the field and cover numeric and target failures.

3. **AF-03 — OPEN: Retain focus during a pending device wipe.** `src/interop/ui/dialogs.tsx:82`. Queue: #174 r5.
   The queue asks for a held-wipe browser regression; existing dialog tests do not establish the pending handoff. Hold storage deletion, assert focus stays on the focusable busy control, and keep its disabled appearance.

4. **AF-04 — OPEN: Buffer paste during a cold rename.** `src/canvas/interaction/domPort.ts:146`. Queue: #255 r3.
   Naming captures key events while fields load; clipboard insertion needs equivalent ordered ownership. Capture paste text through the controller, respect another focused field and test paste before field arrival.

5. **AF-05 — OPEN: Release pending rename ownership after remote deletion.** `src/canvas/interaction/controller.ts:163`. Queue: #255 r3.
   A deleted naming target must not keep swallowing keys. Reconcile capture with document IDs and test deletion before the inspector arrives, followed by an ordinary canvas shortcut.

6. **AF-06 — OPEN: Give Next.js a visible interaction accent.** `src/stencils/catalog.ts:1529`. Queue: #246.
   The black brand accent can disappear in dark focus and selection states. Use a contrast-safe interaction token while preserving brand artwork; verify both themes.

7. **AF-18 — OPEN: Announce why peer deletion closes a menu.** `src/collab/room/RoomUi.tsx:46`. Queue: #177.
   The controller can reconcile targets, but users need a reason for the dismissal. Publish one bounded accessible status message and test deletion of node, edge and boundary targets.

8. **AF-19 — OPEN: No-tracker recovery must offer a useful action.** `src/collab/room/RoomUi.tsx:1046`. Queue: #190.
   Retry cannot create missing deployment endpoints. Show file-copy/settings guidance appropriate to the current build and cover the no-document state.

9. **AF-21 — OPEN: Latency Shift+Tab respects pending logical focus.** `src/canvas/selection/useCanvasNavigation.ts:192`. Queue: #178.
   Repeated forward/backward navigation can race a scheduled focus handoff. Resolve from the pending controller target and assert queued Tab then Shift+Tab before advancing frames.

## Closed or superseded findings

| ID    | Status | Finding and current evidence                                                                                                                                                                                                                                                        | Fixing PR / reason                                       |
| ----- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| AF-07 | DONE   | **Custom-injection modal focus and opening race** — `tests/e2e/live.spec.ts:504`. The production modal regression and controller focus handoff cover the reported Nightly failure.                                                                                                  | [#175](https://github.com/latchkostov/diagrams/pull/175) |
| AF-08 | DONE   | **Latency detail access in read-only and presentation views** — `tests/e2e/hover-cards.spec.ts:125`. Pinned details replace the compact tooltip dead end and explicitly omit Properties where unavailable; the later hover redesign in #250 retains this behavior.                  | [#178](https://github.com/latchkostov/diagrams/pull/178) |
| AF-09 | DONE   | **Keyboard context menus and the no-source hint** — `tests/e2e/trace.spec.ts:185`. Shift+F10 and ContextMenu are wired through canvas interaction, including SVG connections.                                                                                                       | [#205](https://github.com/latchkostov/diagrams/pull/205) |
| AF-10 | DONE   | **Escape from Live More returns focus to its button** — `tests/e2e/trace.spec.ts:147`. The owner-approved handoff is implemented through the interaction controller.                                                                                                                | [#205](https://github.com/latchkostov/diagrams/pull/205) |
| AF-11 | DONE   | **Annotation editing keys, insertion focus and shape-picker handoff** — `tests/e2e/annotations.spec.ts:462`. Buffered annotation input and active-gesture resizing are covered through the editor and Lab.                                                                          | [#213](https://github.com/latchkostov/diagrams/pull/213) |
| AF-12 | DONE   | **Window-pane label clearance and narrow Delay geometry** — `src/canvas/shapes/extendedGeometry.ts:40`. Shared visible-outline geometry and label-safe areas replace the original incorrect attachments.                                                                            | [#213](https://github.com/latchkostov/diagrams/pull/213) |
| AF-13 | DONE   | **Forge dark primary-button hover contrast** — `tests/e2e/confluence-forge.spec.ts:1112`. The settings follow-up supplies readable dark-theme hover colors.                                                                                                                         | [#223](https://github.com/latchkostov/diagrams/pull/223) |
| AF-14 | DONE   | **Forge partial-save recovery message** — `tests/e2e/confluence-forge.spec.ts:971`. The settings alert explains an upload that succeeded before settings failed and how to recover it.                                                                                              | [#223](https://github.com/latchkostov/diagrams/pull/223) |
| AF-15 | DONE   | **Forge validation completion respects the focused option** — `integrations/confluence-forge/src/configure.ts:55`. The focus guard preserves size/theme selection and focus outside the iframe.                                                                                     | [#224](https://github.com/latchkostov/diagrams/pull/224) |
| AF-16 | DONE   | **Inner viewer surfaces consume Escape before Maximise closes** — `integrations/confluence-forge/src/view.ts:34`. The modal delegates Escape to the viewer before closing and pauses inline playback.                                                                               | [#223](https://github.com/latchkostov/diagrams/pull/223) |
| AF-17 | DONE   | **Failed Forge Cancel preserves pending work** — `integrations/confluence-forge/src/configure.ts:28`. Loading and validation continue when the host rejects closure; repeated security/types findings are the same defect.                                                          | [#223](https://github.com/latchkostov/diagrams/pull/223) |
| AF-20 | DONE   | **Keep room actions reachable when the chip shrinks** — `tests/e2e/collab-room.spec.ts:985`. A phone-width browser regression opens the named room chip and checks its menu remains usable within the screen.                                                                       | [#182](https://github.com/latchkostov/diagrams/pull/182) |
| AF-22 | DONE   | **Particle hover cursor loads before TraceCard** — `src/styles/live.css:2670`. The pointer affordance moved into Live CSS; a fresh Live visit no longer needs to open the trace first.                                                                                              | [#205](https://github.com/latchkostov/diagrams/pull/205) |
| AF-23 | DONE   | **Forge completion does not restore focus after the reader leaves the iframe** — `tests/e2e/confluence-forge.spec.ts:1063`. Pending save/load failure tests move focus to the parent before completion and assert it stays there.                                                   | [#223](https://github.com/latchkostov/diagrams/pull/223) |
| AF-24 | DONE   | **Rejected replacement keeps the successful Forge upload checkpoint** — `tests/e2e/confluence-forge.spec.ts:986`. The same Insert/Update checkpoint is retried after validation failure; repeated architecture/correctness/security/types review findings describe this one defect. | [#223](https://github.com/latchkostov/diagrams/pull/223) |
| AF-25 | DONE   | **Both shape catalogs share collapsed browsing policy** — `src/canvas/shapes/menu.ts:5`. The rail and palette expose shape leaves through search and keep browsing collapsed without duplicating separate policies.                                                                 | [#213](https://github.com/latchkostov/diagrams/pull/213) |

## Scope and verification

This is a documentation triage, not an implementation or a new reproduction run. Before taking a batch, recheck its OPEN entries against the then-current master, run the named regression family, and retain any reduced fixture or trace. Tests/CI batches may take separate runner investigations; stop at the bounded evidence step rather than weakening assertions. No application code or output golden changes belong to this triage.
